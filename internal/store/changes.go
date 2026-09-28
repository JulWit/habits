package store

// Undo steps. An Update that calls Tx.Record keeps the rows it replaced and
// the rows it wrote (its diff) in the table changes. Undoing a step writes
// the replaced rows back, redoing it the written ones. Both check first that
// the rows still hold what the step left there, column by column, so that an
// undo never overwrites a change made since, e.g. on another device; such a
// step is dropped with ErrConflict.
//
// The rows a transaction changes are observed through watches: each write
// method first registers a query for the rows it is about to change (watch),
// whose result is the rows' state before. At the end, all watches are read
// again for the state after. A watch must be registered before the first
// write to any of its rows.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"regexp"
	"slices"
	"strings"
	"time"
)

// maxSteps is the number of undo steps kept per user; older ones are
// dropped when a new one is recorded.
const maxSteps = 100

// Label describes an undo step for the user: an English template with
// {name} placeholders, which the client translates like its own texts, and
// the values of the placeholders.
type Label struct {
	Template string         `json:"label"`
	Params   map[string]any `json:"params"`
}

// Step is an undo step as the client sees it.
type Step struct {
	ID int64 `json:"id"`
	Label
}

// Record makes the transaction's change an undo step labelled with template
// and params, alternating names and values. Recording a step drops the steps
// that are undone, as they can no longer be redone.
func (t *Tx) Record(template string, params ...any) {
	label := Label{Template: template, Params: map[string]any{}}
	for i := 0; i+1 < len(params); i += 2 {
		label.Params[params[i].(string)] = params[i+1]
	}
	t.log.label = &label
}

// row is a table row by column name, with the values as the driver returns
// them: int64, string or nil.
type row map[string]any

// rowChange is a row before and after a change; nil means there was none.
type rowChange struct {
	Table  string `json:"table"`
	Before row    `json:"before"`
	After  row    `json:"after"`
}

// watch selects rows a transaction is about to change.
type watch struct {
	table string
	where string
	args  []any
}

// observed is a row as a watch first saw it; row is nil if it did not exist.
type observed struct {
	table string
	row   row
}

// changeLog collects what an Update changes.
type changeLog struct {
	label   *Label
	watches []watch
	// before holds the rows the watches saw first, by rowKey.
	before map[string]observed
}

// tableKey names a table and the columns of its primary key.
type tableKey struct {
	table   string
	columns []string
}

// primaryKeys lists the tables an undo step can cover, parents first, with
// the columns of their primary key.
var primaryKeys = []tableKey{
	{"categories", []string{"id"}},
	{"habits", []string{"id"}},
	{"habit_schedules", []string{"habit_id", "valid_from"}},
	{"entries", []string{"habit_id", "date"}},
}

// tableIndex returns the position of table in primaryKeys, or -1.
func tableIndex(table string) int {
	return slices.IndexFunc(primaryKeys, func(p tableKey) bool { return p.table == table })
}

// keyColumns returns the primary key columns of table.
func keyColumns(table string) []string { return primaryKeys[tableIndex(table)].columns }

// ignoredColumns change without being part of an undo step: timestamps of
// the last change, and positions, as reordering is not an undo step.
var ignoredColumns = []string{"updated_at", "position"}

// rowKey identifies a row of table across snapshots.
func rowKey(table string, r row) string {
	parts := []string{table}
	for _, c := range keyColumns(table) {
		parts = append(parts, fmt.Sprint(r[c]))
	}
	return strings.Join(parts, "\x00")
}

// watch registers the rows of table matching where (with args) as about to
// change and remembers their state before.
func (t *Tx) watch(table, where string, args ...any) error {
	if t.log == nil {
		return errors.New("store: writing in a read-only transaction")
	}
	w := watch{table: table, where: where, args: args}
	for _, known := range t.log.watches {
		if known.table == w.table && known.where == w.where && slices.Equal(known.args, w.args) {
			return nil
		}
	}
	rows, err := t.snapshot(w)
	if err != nil {
		return err
	}
	if t.log.before == nil {
		t.log.before = map[string]observed{}
	}
	for key, r := range rows {
		if _, seen := t.log.before[key]; !seen {
			t.log.before[key] = observed{table: table, row: r}
		}
	}
	t.log.watches = append(t.log.watches, w)
	return nil
}

// snapshot reads the rows selected by w, by rowKey.
func (t *Tx) snapshot(w watch) (map[string]row, error) {
	rows, err := t.query(`SELECT * FROM `+w.table+` WHERE `+w.where, w.args...)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", w.table, err)
	}
	defer rows.Close()
	out := map[string]row{}
	for rows.Next() {
		r, err := scanRow(rows)
		if err != nil {
			return nil, err
		}
		out[rowKey(w.table, r)] = r
	}
	return out, rows.Err()
}

// scanRow scans the current row of rows by column name.
func scanRow(rows *sql.Rows) (row, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	values := make([]any, len(columns))
	pointers := make([]any, len(columns))
	for i := range values {
		pointers[i] = &values[i]
	}
	if err := rows.Scan(pointers...); err != nil {
		return nil, err
	}
	r := row{}
	for i, c := range columns {
		r[c] = normalise(values[i])
	}
	return r, nil
}

// normalise maps a value from the driver or from JSON to int64, string or
// nil, so that values compare alike from either source.
func normalise(v any) any {
	switch v := v.(type) {
	case int:
		return int64(v)
	case []byte:
		return string(v)
	case json.Number:
		if n, err := v.Int64(); err == nil {
			return n
		}
		return v.String()
	case float64:
		return int64(v)
	}
	return v
}

// diff returns the rows the transaction changed so far: each watched row
// whose state differs from before, ordered by table and key.
func (t *Tx) diff() ([]rowChange, error) {
	after := map[string]observed{}
	for _, w := range t.log.watches {
		rows, err := t.snapshot(w)
		if err != nil {
			return nil, err
		}
		for key, r := range rows {
			after[key] = observed{table: w.table, row: r}
		}
	}
	// A row may no longer match its watch, such as a habit whose category was
	// deleted; it is read again by its key.
	for key, b := range t.log.before {
		if _, ok := after[key]; ok || b.row == nil {
			continue
		}
		cur, err := t.current(b.table, b.row)
		if err != nil {
			return nil, err
		}
		if cur != nil {
			after[key] = observed{table: b.table, row: cur}
		}
	}
	keys := slices.Collect(maps.Keys(t.log.before))
	for key := range after {
		if _, ok := t.log.before[key]; !ok {
			keys = append(keys, key)
		}
	}
	slices.SortFunc(keys, func(a, b string) int {
		ta, tb := tableIndex(tableOf(a)), tableIndex(tableOf(b))
		if ta != tb {
			return ta - tb
		}
		return strings.Compare(a, b)
	})

	var out []rowChange
	for _, key := range keys {
		b, a := t.log.before[key], after[key]
		table := b.table
		if table == "" {
			table = a.table
		}
		if b.row == nil && a.row == nil {
			continue
		}
		if b.row != nil && a.row != nil && len(changedColumns(b.row, a.row)) == 0 {
			continue
		}
		out = append(out, rowChange{Table: table, Before: b.row, After: a.row})
	}
	return out, nil
}

// tableOf returns the table of a rowKey.
func tableOf(key string) string {
	table, _, _ := strings.Cut(key, "\x00")
	return table
}

// changedColumns returns the columns whose values differ between a and b,
// without ignoredColumns, in a stable order.
func changedColumns(a, b row) []string {
	var out []string
	for c := range a {
		if slices.Contains(ignoredColumns, c) {
			continue
		}
		if normalise(a[c]) != normalise(b[c]) {
			out = append(out, c)
		}
	}
	slices.Sort(out)
	return out
}

// saveChange keeps the transaction's change as an undo step if it was
// recorded and changed something, and returns its ID.
func (t *Tx) saveChange() (int64, error) {
	if t.log.label == nil {
		return 0, nil
	}
	diff, err := t.diff()
	if err != nil || len(diff) == 0 {
		return 0, err
	}
	if _, err := t.exec(`DELETE FROM changes WHERE user_id = ? AND undone_at IS NOT NULL`, t.userID); err != nil {
		return 0, err
	}
	params, err := json.Marshal(t.log.label.Params)
	if err != nil {
		return 0, err
	}
	encoded, err := json.Marshal(diff)
	if err != nil {
		return 0, err
	}
	res, err := t.exec(
		`INSERT INTO changes (user_id, label, params, diff, created_at) VALUES (?,?,?,?,?)`,
		t.userID, t.log.label.Template, string(params), string(encoded), formatTime(t.now))
	if err != nil {
		return 0, fmt.Errorf("recording the undo step: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	_, err = t.exec(`DELETE FROM changes WHERE user_id = ? AND id NOT IN (
		SELECT id FROM changes WHERE user_id = ? ORDER BY id DESC LIMIT ?)`,
		t.userID, t.userID, maxSteps)
	return id, err
}

// storedStep is an undo step as stored.
type storedStep struct {
	Step
	diff []rowChange
}

// loadStep returns the user's undo step id, or with id 0 the latest one that
// can be undone (undone false) or redone (undone true). A step that is not in
// that state is ErrNotFound.
func (t *Tx) loadStep(id int64, undone bool) (storedStep, error) {
	state := `undone_at IS NULL`
	order := `id DESC`
	if undone {
		state = `undone_at IS NOT NULL`
		order = `undone_at DESC`
	}
	query := `SELECT id, label, params, diff FROM changes WHERE user_id = ? AND ` + state
	args := []any{t.userID}
	if id != 0 {
		query += ` AND id = ?`
		args = append(args, id)
	}
	query += ` ORDER BY ` + order + ` LIMIT 1`

	var (
		s              storedStep
		params, diffJS string
	)
	err := t.queryRow(query, args...).Scan(&s.ID, &s.Template, &params, &diffJS)
	if errors.Is(err, sql.ErrNoRows) {
		return storedStep{}, ErrNotFound
	}
	if err != nil {
		return storedStep{}, err
	}
	if err := json.Unmarshal([]byte(params), &s.Params); err != nil {
		return storedStep{}, fmt.Errorf("undo step %d: %w", s.ID, err)
	}
	dec := json.NewDecoder(strings.NewReader(diffJS))
	dec.UseNumber()
	if err := dec.Decode(&s.diff); err != nil {
		return storedStep{}, fmt.Errorf("undo step %d: %w", s.ID, err)
	}
	for _, rc := range s.diff {
		if err := checkRowChange(rc); err != nil {
			return storedStep{}, fmt.Errorf("undo step %d: %w", s.ID, err)
		}
	}
	return s, nil
}

var columnName = regexp.MustCompile(`^[a-z_]+$`)

// checkRowChange makes sure a stored row change names a known table and
// plain columns only, as they become part of SQL statements.
func checkRowChange(rc rowChange) error {
	if tableIndex(rc.Table) < 0 {
		return fmt.Errorf("unknown table %q", rc.Table)
	}
	for _, r := range []row{rc.Before, rc.After} {
		for c := range r {
			if !columnName.MatchString(c) {
				return fmt.Errorf("invalid column %q", c)
			}
		}
		if r != nil {
			for _, c := range keyColumns(rc.Table) {
				if _, ok := r[c]; !ok {
					return fmt.Errorf("row of %s without %s", rc.Table, c)
				}
			}
		}
	}
	return nil
}

// Undo undoes the user's undo step id, or with id 0 the latest one, and
// returns it. It is ErrNotFound if there is none, and ErrConflict, which
// drops the step, if its rows were changed since.
func (s *Store) Undo(ctx context.Context, userID string, id int64) (Step, error) {
	return s.turn(ctx, userID, id, false)
}

// Redo redoes the user's undone step id, or with id 0 the one undone last,
// and returns it. Errors as for Undo.
func (s *Store) Redo(ctx context.Context, userID string, id int64) (Step, error) {
	return s.turn(ctx, userID, id, true)
}

// turn undoes (redo false) or redoes a step. The rows it changes are
// observed like those of any Update, so the step keeps what the undo really
// changed, including rows removed along with others, such as the entries of
// a habit whose creation is undone; a redo puts them back.
func (s *Store) turn(ctx context.Context, userID string, id int64, redo bool) (Step, error) {
	var (
		step     storedStep
		conflict bool
	)
	_, err := s.Update(ctx, userID, func(t *Tx) error {
		var err error
		if step, err = t.loadStep(id, redo); err != nil {
			return err
		}
		if err := t.watchStep(step.diff, redo); err != nil {
			return err
		}
		if !t.stepApplies(step.diff, redo) {
			conflict = true
			_, err := t.exec(`DELETE FROM changes WHERE id = ?`, step.ID)
			return err
		}
		if err := t.applyStep(step.diff, redo); err != nil {
			return err
		}
		changed, err := t.diff()
		if err != nil {
			return err
		}
		// The step keeps its diff from the undone to the done state.
		undoneAt := any(nil)
		if !redo {
			changed = inverse(changed)
			undoneAt = formatTime(t.now)
		}
		encoded, err := json.Marshal(changed)
		if err != nil {
			return err
		}
		_, err = t.exec(`UPDATE changes SET diff = ?, undone_at = ? WHERE id = ?`,
			string(encoded), undoneAt, step.ID)
		return err
	})
	switch {
	case err != nil:
		return Step{}, err
	case conflict:
		return Step{}, ErrConflict
	}
	return step.Step, nil
}

// inverse swaps the states before and after of each row change.
func inverse(diff []rowChange) []rowChange {
	out := make([]rowChange, len(diff))
	for i, rc := range diff {
		out[i] = rowChange{Table: rc.Table, Before: rc.After, After: rc.Before}
	}
	return out
}

// ends returns the state a row change expects (from) and the one it writes
// (to): undoing goes from After to Before, redoing the other way.
func ends(rc rowChange, redo bool) (from, to row) {
	if redo {
		return rc.Before, rc.After
	}
	return rc.After, rc.Before
}

// watchStep registers the rows an undo or redo of diff changes, including
// rows that go along with a removed row: the schedules and entries of a
// habit, and the habits of a category, which lose it.
func (t *Tx) watchStep(diff []rowChange, redo bool) error {
	for _, rc := range diff {
		from, to := ends(rc, redo)
		r := from
		if r == nil {
			r = to
		}
		where, args := keyWhere(rc.Table, r)
		if err := t.watch(rc.Table, where, args...); err != nil {
			return err
		}
		if to != nil {
			continue
		}
		var err error
		switch rc.Table {
		case "habits":
			err = errors.Join(
				t.watch("habit_schedules", "habit_id = ?", r["id"]),
				t.watch("entries", "habit_id = ?", r["id"]))
		case "categories":
			err = t.watch("habits", "category_id = ?", r["id"])
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// keyWhere returns the condition selecting r by its primary key.
func keyWhere(table string, r row) (string, []any) {
	var conds []string
	var args []any
	for _, c := range keyColumns(table) {
		conds = append(conds, c+" = ?")
		args = append(args, r[c])
	}
	return strings.Join(conds, " AND "), args
}

// current returns the stored row of table with the key of r, or nil.
func (t *Tx) current(table string, r row) (row, error) {
	where, args := keyWhere(table, r)
	rows, err := t.query(`SELECT * FROM `+table+` WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, rows.Err()
	}
	return scanRow(rows)
}

// stepApplies reports whether every row an undo or redo of diff changes
// still holds the state the step expects: a row to remove or update still has
// the values the step left in the columns it changed, and a row to put back
// does not exist.
func (t *Tx) stepApplies(diff []rowChange, redo bool) bool {
	for _, rc := range diff {
		from, to := ends(rc, redo)
		key := from
		if key == nil {
			key = to
		}
		cur, err := t.current(rc.Table, key)
		if err != nil {
			return false
		}
		switch {
		case from == nil:
			if cur != nil {
				return false
			}
		case cur == nil:
			return false
		default:
			columns := changedColumns(from, to)
			if to == nil {
				columns = slices.Collect(maps.Keys(from))
			}
			for _, c := range columns {
				if slices.Contains(ignoredColumns, c) {
					continue
				}
				if normalise(cur[c]) != normalise(from[c]) {
					return false
				}
			}
		}
	}
	return true
}

// applyStep writes the rows of an undo or redo of diff: first it removes
// rows, children first, then puts rows back, parents first, then updates
// the others.
func (t *Tx) applyStep(diff []rowChange, redo bool) error {
	byTable := func(parentsFirst bool) []rowChange {
		sorted := slices.Clone(diff)
		slices.SortStableFunc(sorted, func(a, b rowChange) int {
			d := tableIndex(a.Table) - tableIndex(b.Table)
			if !parentsFirst {
				d = -d
			}
			return d
		})
		return sorted
	}
	for _, rc := range byTable(false) {
		if from, to := ends(rc, redo); from != nil && to == nil {
			where, args := keyWhere(rc.Table, from)
			if _, err := t.exec(`DELETE FROM `+rc.Table+` WHERE `+where, args...); err != nil {
				return err
			}
		}
	}
	for _, rc := range byTable(true) {
		if from, to := ends(rc, redo); from == nil && to != nil {
			if err := t.insertRow(rc.Table, to); err != nil {
				return err
			}
		}
	}
	for _, rc := range byTable(true) {
		if from, to := ends(rc, redo); from != nil && to != nil {
			if err := t.updateRow(rc.Table, to, changedColumns(from, to)); err != nil {
				return err
			}
		}
	}
	return nil
}

// insertRow inserts r into table.
func (t *Tx) insertRow(table string, r row) error {
	columns := slices.Sorted(maps.Keys(r))
	args := make([]any, len(columns))
	for i, c := range columns {
		args[i] = normalise(r[c])
	}
	marks := strings.TrimSuffix(strings.Repeat("?,", len(columns)), ",")
	_, err := t.exec(`INSERT INTO `+table+` (`+strings.Join(columns, ", ")+`) VALUES (`+marks+`)`, args...)
	return err
}

// updateRow sets the columns of the stored row with the key of r to the
// values of r, and its updated_at to now if it has one.
func (t *Tx) updateRow(table string, r row, columns []string) error {
	var sets []string
	var args []any
	for _, c := range columns {
		sets = append(sets, c+" = ?")
		args = append(args, normalise(r[c]))
	}
	if _, ok := r["updated_at"]; ok {
		sets = append(sets, "updated_at = ?")
		args = append(args, formatTime(t.now))
	}
	if len(sets) == 0 {
		return nil
	}
	where, keyArgs := keyWhere(table, r)
	_, err := t.exec(`UPDATE `+table+` SET `+strings.Join(sets, ", ")+` WHERE `+where, append(args, keyArgs...)...)
	return err
}

// PurgeSteps removes undo steps older than olderThan and returns their
// number.
func (s *Store) PurgeSteps(ctx context.Context, olderThan time.Duration) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM changes WHERE created_at < ?`,
		formatTime(time.Now().Add(-olderThan)))
	if err != nil {
		return 0, fmt.Errorf("purging undo steps: %w", err)
	}
	return res.RowsAffected()
}
