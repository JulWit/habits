package domain

import "slices"

// ConvertKind returns the schedules and entries of h converted to kind k, so
// that a change of kind keeps the history meaningful. target is the daily
// target for k, in its stored units:
//
//   - To KindCheck, every day that met its target stays ticked, the others
//     lose their value; completion and streaks stay as they were. A limit
//     becomes a plain target, as a check habit has none; its days without
//     a value, complete under the limit, stay empty.
//   - From KindCheck, every ticked day gets target, and so does every
//     schedule.
//   - Between measured kinds, targets and values keep their displayed number
//     in the new unit (8 glasses become 8 minutes), within the new kind's
//     range. As targets and values scale alike, completion is kept too.
//
// Skipped days and notes are kept.
func ConvertKind(h Habit, entries map[Date]Entry, k Kind, target int) ([]Schedule, map[Date]Entry) {
	schedules := slices.Clone(h.Schedules)
	out := make(map[Date]Entry, len(entries))
	for d, e := range entries {
		e.Value = convertValue(h, d, e.Value, k, target)
		if !e.IsZero() {
			out[d] = e
		}
	}
	for i := range schedules {
		switch {
		case k == h.Kind:
		case k == KindCheck:
			schedules[i].TargetValue = 1
			schedules[i].TargetType = TargetAtLeast
		case h.Kind == KindCheck:
			schedules[i].TargetValue = target
		default:
			schedules[i].TargetValue = rescaleTarget(schedules[i], h.Kind, k)
		}
	}
	return schedules, out
}

// convertValue converts the value v that h has on d to kind k (see
// ConvertKind).
func convertValue(h Habit, d Date, v int, k Kind, target int) int {
	switch {
	case v == 0 || k == h.Kind:
		return v
	case k == KindCheck:
		if h.IsComplete(d, v) {
			return 1
		}
		return 0
	case h.Kind == KindCheck:
		return target
	}
	return rescale(v, h.Kind, k)
}

// rescaleTarget converts the target of s from kind from to kind to. A limit
// of 0 stays 0.
func rescaleTarget(s Schedule, from, to Kind) int {
	if s.isLimit() && s.TargetValue == 0 {
		return 0
	}
	return rescale(s.TargetValue, from, to)
}

// rescale converts a stored value of kind from to kind to, keeping its
// displayed number, rounded and limited to the range of to.
func rescale(v int, from, to Kind) int {
	n := (v*to.Scale() + from.Scale()/2) / from.Scale()
	return min(max(n, 1), to.MaxTarget())
}
