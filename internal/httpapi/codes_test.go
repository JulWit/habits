package httpapi

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Every problem code the server can send has a German message in i18n.js,
// which the client looks up by code.
func TestEveryProblemCodeIsTranslated(t *testing.T) {
	i18n, err := os.ReadFile(filepath.Join("..", "..", "web", "assets", "js", "i18n.js"))
	if err != nil {
		t.Fatal(err)
	}
	_, block, found := strings.Cut(string(i18n), "const deErrors = {")
	if !found {
		t.Fatal("i18n.js has no deErrors")
	}
	block, _, _ = strings.Cut(block, "\n};")
	translated := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^\s+(\w+):`).FindAllStringSubmatch(block, -1) {
		translated[m[1]] = true
	}

	// Codes written as literals: domain.Invalid, writeError and auth.
	literal := regexp.MustCompile(`Invalid\("(\w+)"|writeError\(w, [^,]+, "(\w+)"|Code:\s+"(\w+)"`)
	codes := map[string]bool{}
	root := filepath.Join("..", "..", "internal")
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, m := range literal.FindAllStringSubmatch(string(src), -1) {
			codes[m[1]+m[2]+m[3]] = true
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) < 40 {
		t.Fatalf("found only %d codes; is the pattern still right?", len(codes))
	}
	// A generic fallback for errors that are not problems.
	delete(codes, "error")
	for code := range codes {
		if !translated[code] {
			t.Errorf("code %q has no German message in i18n.js", code)
		}
	}
}
