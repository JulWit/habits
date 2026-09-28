# Data model

## Categories

Categories group habits into blocks on the overview. Habits without a
category are shown in a "No category" block; without any categories, the board
is a single block without headings. When a category is deleted, its habits
stay without one; undoing the deletion puts them back.

## Kinds

- `check`: done or not
- `count`: a number, e.g. 8 glasses
- `time`: minutes
- `distance`: stored in metres, shown in kilometres

A day's value is one integer; counts and minutes are stored in tenths.

Changing the kind of a habit converts its history (`domain.ConvertKind`): to
check, completed days stay ticked; from check, ticked days get the new target;
between measured kinds, values and targets keep their number in the new unit.
Completion and streaks stay the same. Skipped days are kept. A limit
becomes a plain target, as check habits have none.

## Entries

A day's entry (`domain.Entry`) holds its value and whether the day is
skipped. Days with nothing recorded have no row in `entries`. A value or a
skip can only be recorded on a due day; removing is possible on any day.

**Skipped days** (sick, on holiday) count as not due: they neither extend nor
break a streak and are left out of the completion rate. A skipped day has no
value; recording a value ends the skip. For times-per-week and
times-per-month habits, each skipped day lowers the period's target in
proportion, rounded up (three times a week with four days skipped needs two),
future skipped days included, so a planned holiday counts for the current week.
A period skipped entirely neither extends nor breaks the streak. A range of
days skipped at once (`domain.DaysToSkip`) only changes due days without a
value, so what was done on a day is never erased by a holiday.

## Targets and limits

A measured habit (count, time, distance) has a target to reach (`at_least`,
done when `value >= target`) or a limit to stay within (`at_most`, done when
`value <= target`). A limit may be 0, "none at all". A limit is also kept by a
day without a value, from the habit's first day on: nothing recorded means
nothing consumed. As empty days keep it, a limit needs fixed due days: it
cannot be combined with `times_per_week` or `times_per_month`, whose count of
completed days would always be met. Check habits always have the target 1.

## Frequencies

- `daily`
- `times_per_week`: x times per week (weeks start on Monday)
- `times_per_month`: x times per calendar month (1 to 28, so the target fits
  every month)
- `weekdays`: selected weekdays (bitmask, bit 0 = Monday), optionally only every
  n-th week from an anchor date, or only the n-th or last occurrence in the
  month
- `custom_interval`: every n days from an anchor date

The frequency rules exist only on the server (`domain.Schedule.IsScheduled`);
see [DATAFLOW.md](DATAFLOW.md#day-statuses) for how the client learns the
status of each day.

## Schedules

Target, target type (target or limit) and frequency are versioned in
`habit_schedules`. A change in the editor starts a new version from today on;
past days keep the target and frequency they had, so their completion and
streaks do not change. Several changes on one day replace that day's version,
and changing back merges it with the previous one. "Apply to past days as
well" replaces the whole history with the new schedule. The first version also
covers days before it (entries recorded before the habit was created). A
change of kind converts the history (see [Kinds](#kinds)).

For a times-per-week or times-per-month habit, periods from before a switch to
that frequency are met when every day due in them was completed; periods
without a due day neither extend nor break the streak.

## Streaks

An open today does not break a streak, and skipped days neither extend nor
break it. For `times_per_week`, the streak counts weeks; for
`times_per_month`, months. Both are counted by `domain.period`.

**Completion rate**: the share of the due days completed in the days of the
`rateWindow` setting (30 by default, or the whole history), from the habit's
first day on; skipped days are left out. For times-per-week and
times-per-month habits, the window is extended to whole periods and counts
completions (`domain.ComputeStats`).

**Streak colours**: A completed day is coloured by how long its run had lasted
on that day: one week, two weeks, a month, three months, six months, a year.
The longer the run, the more of a gradient around the habit colour shows. Run
lengths are in calendar days. The server sends the runs as `streakRuns`
(`domain.StreakRuns`); the colouring is in `habit-helpers.js`.

## Colours

Habits, categories and the accent colour store palette names (`red`, `teal`,
…). `base.css` defines their shades as `--c-red` and so on, and `colorValue()`
in `icons.js` maps a name to its custom property. Changing a shade needs no
migration.

## Database schema

The tables are `STRICT`, with `CHECK` constraints for kinds, frequencies,
dates and values. Every user-owned row refers to `users` with `ON DELETE
CASCADE`; a user is recorded on their first write.

`PRAGMA user_version` stores the schema version. See
[EXTENDING.md](EXTENDING.md#new-migration) for adding a migration.

Deleting a habit or a category removes its rows. The table `changes` keeps
the undo steps: the rows a change replaced and wrote, as JSON (see
[DATAFLOW.md](DATAFLOW.md#undo)). The latest 100 steps per user are kept;
steps older than 30 days are removed on start and once a day.

Settings are stored per user as one JSON document; see
[USAGE.md](USAGE.md#settings).
