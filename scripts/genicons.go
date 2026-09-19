// Command genicons draws the app icon into the PNG sizes a web app manifest
// needs. Run it after changing web/assets/icon.svg:
//
//	go run ./scripts/genicons
//
// Drawn rather than rasterised: the icon is a rounded square and a tick in an
// opened ring, which is a dozen lines of geometry, and that saves the repository
// an image toolchain it would otherwise need for three files.
package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
)

// The icon itself, in the 24x24 coordinates the title bar's mark is drawn in -
// icon.svg shows the same shape at the 0.72 its tile leaves it.
var (
	background = color.NRGBA{R: 0x1b, G: 0x1d, B: 0x21, A: 0xff}
	ink        = color.NRGBA{R: 0xff, G: 0xff, B: 0xff, A: 0xff}
	check      = [][2]float64{{8, 12.3}, {10.9, 15.2}, {16.1, 9.2}}
	ringC      = [2]float64{12, 12}
	ringR      = 9.6
	strokeW    = 2.4
	// Where the ring is cut open, in degrees clockwise from three o'clock -
	// four gaps along the bottom, which leave three bars between them. The ends
	// are square, which is what an arc cut at an angle gives on its own.
	ringGaps = [][2]float64{{20, 32}, {62.667, 74.667}, {105.333, 117.333}, {148, 160}}
)

// sample is how many times each pixel is divided per axis before averaging.
// Four is enough for edges this smooth and keeps the whole run under a second.
const sample = 4

func main() {
	out := filepath.Join("web", "assets")
	type job struct {
		name     string
		size     int
		maskable bool
	}
	for _, j := range []job{
		{"icon-192.png", 192, false},
		{"icon-512.png", 512, false},
		{"icon-maskable-512.png", 512, true},
	} {
		if err := write(filepath.Join(out, j.name), j.size, j.maskable); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println("written:", j.name)
	}
}

func write(path string, size int, maskable bool) error {
	img := render(size, maskable)
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("creating %s: %w", path, err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		return fmt.Errorf("writing %s: %w", path, err)
	}
	return nil
}

func render(size int, maskable bool) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, size, size))

	// A maskable icon is cropped to whatever shape the platform likes, so it
	// fills the square and keeps the mark well inside the safe zone.
	scale := 0.72
	radius := 0.25
	if maskable {
		scale = 0.58
		radius = 0
	}

	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			img.SetNRGBA(x, y, pixel(x, y, size, scale, radius))
		}
	}
	return img
}

// pixel averages the sample x sample points inside one pixel, which is what
// gives the corners and the stroke their smooth edge.
func pixel(px, py, size int, scale, radius float64) color.NRGBA {
	var r, g, b, a float64
	unit := float64(size) / 24 * scale
	offset := float64(size)/2 - 12*unit

	for sy := 0; sy < sample; sy++ {
		for sx := 0; sx < sample; sx++ {
			x := float64(px) + (float64(sx)+0.5)/sample
			y := float64(py) + (float64(sy)+0.5)/sample

			c := color.NRGBA{}
			if inRoundedSquare(x, y, float64(size), radius*float64(size)) {
				c = background
				// The mark is drawn in the icon's own coordinates, then moved
				// to wherever the scaled 24x24 box starts.
				if onMark((x-offset)/unit, (y-offset)/unit) {
					c = ink
				}
			}
			r += float64(c.R) * float64(c.A) / 255
			g += float64(c.G) * float64(c.A) / 255
			b += float64(c.B) * float64(c.A) / 255
			a += float64(c.A)
		}
	}

	n := float64(sample * sample)
	if a == 0 {
		return color.NRGBA{}
	}
	// Back out of the premultiplied average, so a pixel on the very edge keeps
	// its colour instead of fading towards black.
	return color.NRGBA{
		R: uint8(math.Round(r / n * 255 / (a / n))),
		G: uint8(math.Round(g / n * 255 / (a / n))),
		B: uint8(math.Round(b / n * 255 / (a / n))),
		A: uint8(math.Round(a / n)),
	}
}

func inRoundedSquare(x, y, size, r float64) bool {
	if r <= 0 {
		return x >= 0 && y >= 0 && x <= size && y <= size
	}
	// Distance to the rounded rectangle, measured from the inner box the
	// corner circles sit on.
	cx := math.Max(r, math.Min(x, size-r))
	cy := math.Max(r, math.Min(y, size-r))
	return math.Hypot(x-cx, y-cy) <= r
}

// onMark reports whether a point in 24x24 icon space lies under the stroke,
// which is the opened ring and the two round-capped segments of the tick.
func onMark(x, y float64) bool {
	half := strokeW / 2
	if onRing(x, y, half) {
		return true
	}
	for i := 0; i < len(check)-1; i++ {
		if distanceToSegment(x, y, check[i], check[i+1]) <= half {
			return true
		}
	}
	return false
}

// onRing is a ring, not a disc: what counts is the distance to the circle
// itself - and then whether the point falls in one of the gaps.
func onRing(x, y, half float64) bool {
	if math.Abs(math.Hypot(x-ringC[0], y-ringC[1])-ringR) > half {
		return false
	}
	angle := math.Atan2(y-ringC[1], x-ringC[0]) * 180 / math.Pi
	if angle < 0 {
		angle += 360
	}
	for _, gap := range ringGaps {
		if angle >= gap[0] && angle <= gap[1] {
			return false
		}
	}
	return true
}

func distanceToSegment(x, y float64, a, b [2]float64) float64 {
	dx, dy := b[0]-a[0], b[1]-a[1]
	length := dx*dx + dy*dy
	if length == 0 {
		return math.Hypot(x-a[0], y-a[1])
	}
	t := ((x-a[0])*dx + (y-a[1])*dy) / length
	t = math.Max(0, math.Min(1, t))
	return math.Hypot(x-(a[0]+t*dx), y-(a[1]+t*dy))
}
