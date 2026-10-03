package httpapi

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
	"testing/fstest"
)

// The modules imported statically, directly or not, are preloaded; a module
// imported on first use and a type import in a comment are not.
func TestPreloadModulesFollowsStaticImports(t *testing.T) {
	web := fstest.MapFS{
		"assets/js/app.js": &fstest.MapFile{Data: []byte(
			"import {a} from './data/a.js';\n" +
				"import './side.js';\n" +
				"const later = () => import('./views/later.js');\n")},
		"assets/js/data/a.js": &fstest.MapFile{Data: []byte(
			"/** @import {T} from './types.js' */\n" +
				"export {b} from '../vue.js';\n")},
		"assets/js/side.js": &fstest.MapFile{Data: []byte("")},
		"assets/js/vue.js": &fstest.MapFile{Data: []byte(
			"export * from '../vendor/vue.js';\n")},
		"assets/vendor/vue.js":     &fstest.MapFile{Data: []byte("export{x as y}")},
		"assets/js/views/later.js": &fstest.MapFile{Data: []byte("")},
	}
	got, err := preloadModules(web)
	if err != nil {
		t.Fatalf("preloadModules: %v", err)
	}
	want := []string{
		"/assets/js/data/a.js",
		"/assets/js/side.js",
		"/assets/js/vue.js",
		"/assets/vendor/vue.js",
	}
	if !slices.Equal(got, want) {
		t.Errorf("preloadModules = %q, want %q", got, want)
	}
}

// The real frontend's imports resolve to files that exist.
func TestPreloadModulesOfTheFrontend(t *testing.T) {
	got, err := preloadModules(os.DirFS(filepath.Join("..", "..", "web")))
	if err != nil {
		t.Fatalf("preloadModules: %v", err)
	}
	for _, want := range []string{"/assets/js/data/state.js", "/assets/vendor/vue.esm-browser.prod.js"} {
		if !slices.Contains(got, want) {
			t.Errorf("preloadModules lacks %s: %q", want, got)
		}
	}
	if slices.Contains(got, "/assets/js/views/style-guide-view.js") {
		t.Errorf("preloadModules lists the style guide, which loads on first use")
	}
}
