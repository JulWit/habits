# Data model

## Categories

Categories group habits into blocks on the overview. Habits without a
category are shown in a "No category" block; without any categories, the board
is a single block without headings. When a category is deleted, its habits keep
their category ID and appear under "No category" until it is restored.

## Kinds

- `check`: done or not
- `count`: a number, e.g. 8 glasses
- `time`: minutes
- `distance`: stored in metres, shown in kilometres

Each entry is one integer per day; counts and minutes are stored in tenths. A
day is done when `value >= target`. Days without a value have no row in
`entries`.

Changing the kind of a habit converts its history (`domain.ConvertKind`): to
check, completed days stay ticked; from check, ticked days get the new target;
between measured kinds, values and targets keep their number in the new unit.
Completion and streaks stay the same.

## Frequencies

- `daily`
- `times_per_week`: x times per week (weeks start on Monday)
- `weekdays`: selected weekdays (bitmask, bit 0 = Monday), optionally only every
  n-th week from an anchor date, or only the n-th or last occurrence in the
  month
- `custom_interval`: every n days from an anchor date

The frequency rules exist only on the server (`domain.Schedule.IsScheduled`);
see [DATAFLOW.md](DATAFLOW.md#due-days) for how the client learns the due days.

## Schedules

Target and frequency are versioned in `habit_schedules`. A change in the
editor starts a new version from today on; past days keep the target and
frequency they had, so their completion and streaks do not change. Several
changes on one day replace that day's version, and changing back merges it
with the previous one. "Apply to past days as well" replaces the whole history
with the new schedule. The first version also covers days before it (entries
recorded before the habit was created). A change of kind converts the history
(see [Kinds](#kinds)).

For a times-per-week habit, weeks from before a switch to times-per-week are
met when every day due in them was completed; weeks without a due day neither
extend nor break the streak.

## Streaks

An open today does not break a streak. For `times_per_week`, the streak counts
weeks.

**Streak colours**: A completed day is coloured by how long its run had lasted
on that day: one week, two weeks, a month, three months, six months, a year.
The longer the run, the more of a gradient around the habit colour shows. Run
lengths are in calendar days. The server sends the runs as `streakRuns`
(`domain.StreakRuns`); the colouring is in `habit.js`.

## Colours

Habits, categories and the accent colour store palette names (`red`, `teal`,
…). `base.css` defines their shades as `--c-red` and so on, and `colorValue()`
in `icons.js` maps a name to its custom property. Changing a shade needs no
migration.

## Database schema

The tables are `STRICT`, with `CHECK` constraints for kinds, frequencies,
dates and values. Every user-owned row refers to `users` with `ON DELETE
CASCADE`; a user is recorded on their first write.

`PRAGMA user_version` stores the schema version: 1 plus the number of
migrations applied. See [EXTENDING.md](EXTENDING.md#new-migration) for adding a
migration.

Deleted habits and categories are soft-deleted and removed permanently on the
first start after 30 days.

Settings are stored per user as one JSON document; see
[USAGE.md](USAGE.md#settings).
