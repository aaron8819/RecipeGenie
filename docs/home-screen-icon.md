# Home Screen icon

The v4 install artwork is Aaron's selected local original,
`C:\Users\aabloch\Downloads\rgicon`: an extensionless PNG containing a cream RG
monogram and light-green leaf on a dark forest-green square. The 1254 x 1254
opaque standard master is copied byte-for-byte from that file. No imagegen,
redrawing, crop, colour adjustment or reinterpretation was used.

## Assets

- `assets/home-screen-icon-v4.png`: unchanged supplied square master.
- `assets/home-screen-icon-maskable-v4.png`: uniformly reduced derivative with
  background extended from edge pixels for mask-safe framing.
- `web/public/apple-touch-icon-v4.png`: 180 x 180 opaque PNG.
- `web/public/pwa-icon-{192,512}-v4.png`: standard icons, purpose `any`.
- `web/public/pwa-icon-maskable-{192,512}-v4.png`: purpose `maskable`.

Runtime PNGs use the existing Sharp dependency. The separate maskable composition
scales the entire source to 78% and extends its green edge pixels, preserving
letter and leaf proportions. Foreground positioning is checked against the
centered 40%-radius safe circle, with visual inspection of the circular crop.
The install images are square and opaque; system corners are not baked in.

Metadata uses `/apple-touch-icon-v4.png` and
`/manifest.json?v=home-icon-v4`, with separate v4 standard/maskable manifest
entries. Earlier versioned assets remain available. App identity, `/dashboard`
launch URL, scope, in-app shell logos and browser favicons are unchanged.

## Review and limits

The ignored `.codex-artifacts/icon-review/` packet retains source identity,
asset checks, actual Next.js served metadata/manifest/PNG verification, the
full master, circular crop, and an accurately labeled 390-point Home Screen
simulation using the real Apple touch asset at 60 points beside neighboring
icons. The wallpaper, neighboring icons and system corner mask are approximations.
This is not a physical iPhone screenshot or an installation test.

Versioned URLs avoid reusing the previous install-asset URLs, but do not guarantee
that an already-installed iPhone shortcut changes automatically. After release,
inspect the icon while adding a fresh shortcut; preserve the existing one until
the new shortcut works. Actual cache refresh and installed appearance remain
physical-device checks. No production data or application behavior is changed.

## Browser tab artwork

Browser favicons now use the same unchanged v4 RG master approved in PR #99.
Sharp resizes the square master with Lanczos3 to opaque 16-, 32- and 48-pixel
PNGs. The ICO bundles all three PNG sizes. Metadata uses versioned v4 PNG/ICO
URLs; the unversioned favicon.ico and favicon-32x32.png compatibility endpoints
also contain the new artwork for clients that request those conventional paths.
The Apple touch/manifest install artwork and in-app shell logos are unchanged.
Small-size inspection checks legibility only; existing browser caches may retain
older icons until refreshed. No physical-device cache refresh is claimed.
