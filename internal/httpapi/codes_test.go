package httpapi

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// Every problem code the server can send has a German message in i18n.js,
// which the client looks up by code.
func TestEveryProblemCodeIsTranslated(t *testing.T) {
	translated := translatedCodes(t)
	for code := range serverCodes(t) {
		if !translated[code] {
			t.Errorf("code %q has no German message in i18n.js", code)
		}
	}
}

// clientCodes are the problem codes the client gives errors itself (api.js).
var clientCodes = []string{"offline", "session_expired"}

// Every German message in i18n.js belongs to a code the server or the client
// still sends, so a removed code does not leave its message behind.
func TestEveryTranslatedCodeIsSent(t *testing.T) {
	sent := serverCodes(t)
	for code := range translatedCodes(t) {
		if !sent[code] && !slices.Contains(clientCodes, code) {
			t.Errorf("i18n.js translates %q, which neither the server nor the client sends", code)
		}
	}
}

// translatedCodes returns the problem codes with a German message in DE_ERRORS
// of i18n.js.
func translatedCodes(t *testing.T) map[string]bool {
	t.Helper()
	i18n, err := os.ReadFile(filepath.Join("..", "..", "web", "assets", "js", "util", "i18n.js"))
	if err != nil {
		t.Fatalf("os.ReadFile(i18n.js): %v", err)
	}
	_, block, found := strings.Cut(string(i18n), "const DE_ERRORS = {")
	if !found {
		t.Fatal("i18n.js has no DE_ERRORS")
	}
	block, _, _ = strings.Cut(block, "\n};")
	translated := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^\s+(\w+):`).FindAllStringSubmatch(block, -1) {
		translated[m[1]] = true
	}
	return translated
}

// serverCodes returns the problem codes the server can send, as written in
// its sources: by domain.Invalid, writeError and auth.
func serverCodes(t *testing.T) map[string]bool {
	t.Helper()
	literal := regexp.MustCompile(`Invalid\("(\w+)"|writeError\(w, [^,]+, "(\w+)"|Code:\s+"(\w+)"`)
	codes := map[string]bool{}
	for _, src := range serverSources(t) {
		for _, m := range literal.FindAllStringSubmatch(src, -1) {
			codes[m[1]+m[2]+m[3]] = true
		}
	}
	if len(codes) < 40 {
		t.Fatalf("found only %d codes; is the pattern still right?", len(codes))
	}
	// A generic fallback for errors that are not problems.
	delete(codes, "error")
	return codes
}

// Every template of domain.Invalid is an error string: it starts in lower
// case and has no trailing punctuation. The client capitalises the English
// message when it shows it.
func TestProblemTemplatesAreErrorStrings(t *testing.T) {
	// Templates are string literals in double quotes or backticks (\x60).
	literal := regexp.MustCompile(`Invalid\("(\w+)",\s*["\x60]([^"\x60]*)["\x60]`)
	n := 0
	for path, src := range serverSources(t) {
		for _, m := range literal.FindAllStringSubmatch(src, -1) {
			n++
			code, template := m[1], m[2]
			if first := template[:1]; first != strings.ToLower(first) || strings.HasSuffix(template, ".") {
				t.Errorf("%s: template of %q is not an error string: %q", path, code, template)
			}
		}
	}
	if n < 40 {
		t.Fatalf("found only %d templates; is the pattern still right?", n)
	}
}

// serverSources returns the Go sources of the server without its tests, by
// path.
func serverSources(t *testing.T) map[string]string {
	t.Helper()
	out := map[string]string{}
	root := filepath.Join("..", "..", "internal")
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		out[path] = string(src)
		return nil
	})
	if err != nil {
		t.Fatalf("reading the server sources: %v", err)
	}
	return out
}
