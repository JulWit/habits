// Command genicons renders the PNG app icons for the web app manifest. Run it
// after changing web/assets/images/icon.svg:
//
//	go run ./scripts/genicons.go
//
// The icon geometry is defined in code, so no image toolchain is needed.
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

// Icon geometry in 24x24 coordinates, matching icon.svg.
var (
	background  = color.NRGBA{R: 0x25, G: 0x63, B: 0xeb, A: 0xff}
	ink         = color.NRGBA{R: 0xff, G: 0xff, B: 0xff, A: 0xff}
	checkMark   = [][2]float64{{8, 12.3}, {10.9, 15.2}, {16.1, 9.2}}
	ringCenter  = [2]float64{12, 12}
	ringRadius  = 9.6
	strokeWidth = 2.4
	// Gaps in the ring, in degrees clockwise from three o'clock.
	ringGaps = [][2]float64{{20, 32}, {62.667, 74.667}, {105.333, 117.333}, {148, 160}}
)

// samplesPerAxis is the number of antialiasing samples per pixel along each
// axis.
const samplesPerAxis = 4

func main() {
	out := filepath.Join("web", "assets", "images")
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

// write renders the icon and saves it as a PNG file at path.
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

// render draws the icon at size x size pixels.
func render(size int, maskable bool) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, size, size))

	// A maskable icon fills the whole square and keeps the mark inside the
	// safe zone.
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

// pixel returns the antialiased colour of a pixel.
func pixel(px, py, size int, scale, radius float64) color.NRGBA {
	var r, g, b, a float64
	unit := float64(size) / 24 * scale
	offset := float64(size)/2 - 12*unit

	for sy := 0; sy < samplesPerAxis; sy++ {
		for sx := 0; sx < samplesPerAxis; sx++ {
			x := float64(px) + (float64(sx)+0.5)/samplesPerAxis
			y := float64(py) + (float64(sy)+0.5)/samplesPerAxis

			c := color.NRGBA{}
			if inRoundedSquare(x, y, float64(size), radius*float64(size)) {
				c = background
				// Convert to 24x24 icon coordinates.
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

	n := float64(samplesPerAxis * samplesPerAxis)
	if a == 0 {
		return color.NRGBA{}
	}
	// Convert from premultiplied to straight alpha.
	return color.NRGBA{
		R: uint8(math.Round(r / n * 255 / (a / n))),
		G: uint8(math.Round(g / n * 255 / (a / n))),
		B: uint8(math.Round(b / n * 255 / (a / n))),
		A: uint8(math.Round(a / n)),
	}
}

// inRoundedSquare reports whether (x, y) lies in a square of the given size
// with corner radius r.
func inRoundedSquare(x, y, size, r float64) bool {
	if r <= 0 {
		return x >= 0 && y >= 0 && x <= size && y <= size
	}
	cx := math.Max(r, math.Min(x, size-r))
	cy := math.Max(r, math.Min(y, size-r))
	return math.Hypot(x-cx, y-cy) <= r
}

// onMark reports whether a point in icon coordinates lies on the ring or the
// check mark.
func onMark(x, y float64) bool {
	half := strokeWidth / 2
	if onRing(x, y, half) {
		return true
	}
	for i := 0; i < len(checkMark)-1; i++ {
		if distanceToSegment(x, y, checkMark[i], checkMark[i+1]) <= half {
			return true
		}
	}
	return false
}

// onRing reports whether a point lies on the ring stroke outside its gaps.
func onRing(x, y, half float64) bool {
	if math.Abs(math.Hypot(x-ringCenter[0], y-ringCenter[1])-ringRadius) > half {
		return false
	}
	angle := math.Atan2(y-ringCenter[1], x-ringCenter[0]) * 180 / math.Pi
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

// distanceToSegment returns the distance from (x, y) to the segment a-b.
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
