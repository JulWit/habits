package domain

// valued returns entries holding the given values, for tests that skip no
// days.
func valued(values map[Date]int) map[Date]Entry {
	out := make(map[Date]Entry, len(values))
	for d, v := range values {
		out[d] = Entry{Value: v}
	}
	return out
}
