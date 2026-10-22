# website-to-3d-video

**Turn any website into a 3D video.** Paste a link, pick a format and music, and get a cinematic fly-over of the page as an MP4 in about a minute. The camera glides down the page, cards and photos lift off in 3D with depth of field and motion blur, and the film ends on a title card with the brand.

Everything runs locally. No AI and no subscriptions are needed.

## Requirements

- macOS (tested on Apple Silicon; the renderer uses the GPU through Chrome/Metal)
- [Node.js](https://nodejs.org) 20 or newer
- [ffmpeg](https://ffmpeg.org) (`brew install ffmpeg`)
- Google Chrome (optional, recommended: pages with H.264 videos capture correctly)

## Install

```bash
git clone https://github.com/yrdagency/website-to-3d-video.git
cd website-to-3d-video
npm run setup
```

`setup` installs the dependencies, the Playwright browser, builds the chat interface and downloads the music tracks.

## Use it

### Chat interface

```bash
npm start
```

Open http://localhost:5178 and paste a link. The bar under the input sets format, length, camera, music, quality and frame rate; **+** adds a logo, a music file or a new headline. Every change makes a new video automatically.

### Command line

```bash
node flyover.mjs https://example.com --format 9:16 --music momentum
```

| Option | Values | Default |
|---|---|---|
| `--format` | `5:4`, `16:9`, `9:16`, `1:1`, `4:5` | `5:4` |
| `--quality` | `720`, `1080`, `1440` (short side, px) | `720` |
| `--fps` | `24`, `30`, `60` | `30` |
| `--duration` | `10`–`30` seconds | automatic |
| `--style` | `calm`, `default`, `energetic` | `default` |
| `--music` | `pulse`, `neon-grid`, `launch-day`, `momentum`, `clean-lines`, `midnight`, `drift` | effects only |
| `--track` | path to your own audio file | |
| `--brand`, `--logo`, `--line1`, `--tail` | end-card brand, logo image, headline, second line | taken from the page |
| `--no-sound` | | |
| `--stills-only` | render preview frames, no MP4 | |
| `--recapture` | capture the page again instead of reusing it | |

Output: `out/<name>.mp4` plus a contact sheet of stills in `out/<name>-stills/`.

## How it works

1. **Capture** (`capture.mjs`): Playwright opens the page, scrolls it so lazy content loads, freezes animations, flattens sticky sections and carousels, then screenshots the page and every card, photo and button separately.
2. **Scene** (`scenes/<name>/scene.json`): the captured pieces and landmarks, editable. Per-site fixes go in `sites/*.json` (see `sites/example.json`).
3. **Film** (`film.html`): a WebGL2 renderer where every frame is a pure function of time: camera path from one speed curve, per-pixel depth of field, shadows, motion-blur subframes and the end card.
4. **Sound** (`sound.mjs`): synthesized effects that follow the camera, plus optional music aligned so a downbeat lands on the end card.
5. **Encode** (`render.mjs`): frames stream from the page to ffmpeg (H.264).

## Music

The tracks are not included in this repository. `npm run music` downloads them from Pixabay ([Pixabay Content License](https://pixabay.com/service/license-summary/): free for commercial use, no attribution required). They are registered in YouTube Content ID, so an automatic claim on YouTube or Facebook is possible; it can be disputed with the Pixabay license. Sources and artists are listed in `music/library.json`.

## End-card text

By default the headline comes from the page's main heading and the second line from its main button. If `ANTHROPIC_API_KEY` is set, Claude writes them instead, in the page's language.

## License

[MIT](LICENSE)
