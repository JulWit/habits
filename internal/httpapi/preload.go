package httpapi

import (
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"slices"
	"strings"
)

// entryModule is the module index.html loads, from which the others are
// imported.
const entryModule = "assets/js/app.js"

// staticImport matches the module a line of a frontend module imports
// statically: `import … from '…'`, `export … from '…'` and `import '…'`. The
// formatter keeps an import on one line. Dynamic imports (`import(…)`) and
// type imports in comments do not start a line and are left out, so a module
// loaded on first use is not preloaded.
var staticImport = regexp.MustCompile(`(?m)^(?:(?:import|export)\b[^'\n]*\bfrom|import)\s+'([^']+)'`)

// preloadModules returns the URLs of the modules the entry module imports,
// directly or through others, sorted. index.html lists them as
// modulepreload links, so the browser requests them all at once instead of
// discovering them one level of imports after the other.
func preloadModules(webFS fs.FS) ([]string, error) {
	seen := map[string]bool{entryModule: true}
	queue := []string{entryModule}
	for len(queue) > 0 {
		name := queue[0]
		queue = queue[1:]
		// The vendored Vue build is preloaded but not read: it imports
		// nothing.
		if !strings.HasPrefix(name, "assets/js/") {
			continue
		}
		source, err := fs.ReadFile(webFS, name)
		if err != nil {
			return nil, fmt.Errorf("reading module %s: %w", name, err)
		}
		for _, match := range staticImport.FindAllSubmatch(source, -1) {
			imported := path.Join(path.Dir(name), string(match[1]))
			if seen[imported] {
				continue
			}
			seen[imported] = true
			queue = append(queue, imported)
		}
	}

	delete(seen, entryModule)
	urls := make([]string, 0, len(seen))
	for name := range seen {
		urls = append(urls, "/"+name)
	}
	slices.Sort(urls)
	return urls, nil
}
