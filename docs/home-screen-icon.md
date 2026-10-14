# Home Screen icon

The v3 artwork follows the chat attachment: simplified cream chef/genie,
gold serving dome and short thick curled tail on dark green. The built-in
imagegen edit removed the white exterior and rounded background corners,
preserving the supplied design. The prompt requested crisp edges, opaque
full-bleed green, balanced framing and no added details, shine or distortion.

## Files

- docs/assets/home-screen-icon-v3.png: 1254 x 1254 opaque square master.
- docs/assets/home-screen-icon-maskable-v3.png: separate 1254 x 1254 master.
- web/public/apple-touch-icon-v3.png: 180 x 180.
- web/public/pwa-icon-{192,512}-v3.png: standard icons, purpose any.
- web/public/pwa-icon-maskable-{192,512}-v3.png: purpose maskable.

Runtime PNGs are resized with Sharp from the masters. Maskable artwork is
scaled to 78%; the green background extends by copying edge pixels, avoiding
a visible inner tile. Detected cream/gold foreground radius is 31.48% of the
canvas, within the centered 40%-radius safe circle. PNGs have no alpha channel.
No system corner mask is baked into any install asset.

Metadata points to /apple-touch-icon-v3.png and
/manifest.json?v=home-icon-v3. The manifest uses v3 filenames with separate
standard and maskable entries. Existing app identity, /dashboard launch URL,
scope, shell logos and browser favicons are preserved. Existing installed
shortcuts may retain cached artwork; versioning targets new installations.

## Review evidence

Ignored .codex-artifacts/icon-review contains the preparation script,
asset checks, actual Next.js HTTP checks and previews. The iPhone simulation
uses the actual Apple touch PNG at 60 points in a 390-point-wide layout.
Its system corner mask and neighboring icons are approximations.
It is not a physical iPhone screenshot or installation test.

Local verification covers dimensions, opacity, mask-safe positioning,
served Next.js page metadata, manifest URLs and matching served PNG bytes.
Only local placeholder auth configuration is used; no database-backed
scenario is run. Visual approval is required before publication.
