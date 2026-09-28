package main

import "testing"

func TestHealthcheckURL(t *testing.T) {
	for addr, want := range map[string]string{
		":8080":          "http://127.0.0.1:8080/healthz",
		"0.0.0.0:9000":   "http://127.0.0.1:9000/healthz",
		"[::]:8080":      "http://[::1]:8080/healthz",
		"10.0.0.5:8080":  "http://10.0.0.5:8080/healthz",
		"localhost:8080": "http://localhost:8080/healthz",
	} {
		got, err := healthcheckURL(addr)
		if err != nil || got != want {
			t.Errorf("healthcheckURL(%q) = %q, %v; want %q", addr, got, err, want)
		}
	}
	if _, err := healthcheckURL("8080"); err == nil {
		t.Error("an address without a port was accepted")
	}
}
