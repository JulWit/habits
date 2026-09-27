package domain

import "slices"

// ConvertKind returns the schedules and entries of h converted to kind k, so
// that a change of kind keeps the history meaningful. target is the daily
// target for k, in its stored units:
//
//   - To KindCheck, every day that reached its target stays ticked, the others
//     are dropped; completion and streaks stay as they were.
//   - From KindCheck, every ticked day gets target, and so does every
//     schedule.
//   - Between measured kinds, targets and values keep their displayed number
//     in the new unit (8 glasses become 8 minutes), within the new kind's
//     range. As targets and values scale alike, completion is kept too.
func ConvertKind(h Habit, entries map[Date]int, k Kind, target int) ([]Schedule, map[Date]int) {
	schedules := slices.Clone(h.Schedules)
	out := make(map[Date]int, len(entries))
	for d, v := range entries {
		switch {
		case k == h.Kind:
			out[d] = v
		case k == KindCheck:
			if h.IsComplete(d, v) {
				out[d] = 1
			}
		case h.Kind == KindCheck:
			if v > 0 {
				out[d] = target
			}
		default:
			out[d] = rescale(v, h.Kind, k)
		}
	}
	for i := range schedules {
		switch {
		case k == h.Kind:
		case k == KindCheck:
			schedules[i].TargetValue = 1
		case h.Kind == KindCheck:
			schedules[i].TargetValue = target
		default:
			schedules[i].TargetValue = rescale(schedules[i].TargetValue, h.Kind, k)
		}
	}
	return schedules, out
}

// rescale converts a stored value of kind from to kind to, keeping its
// displayed number, rounded and limited to the range of to.
func rescale(v int, from, to Kind) int {
	n := (v*to.Scale() + from.Scale()/2) / from.Scale()
	return min(max(n, 1), to.MaxTarget())
}
