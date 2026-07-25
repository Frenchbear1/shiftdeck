# Shiftdeck

Shiftdeck turns schedule photos into a phone-friendly work reference for shifts,
crew coverage, flights, and Apple Calendar exports.

## What Works On GitHub Pages

- Schedule photo upload and review
- Worker timeline and roster views
- Flight board views
- Device-local settings and duplicate export warnings
- One-time Apple Calendar `.ics` export

GitHub Pages is static hosting, so it cannot run the subscribed calendar feed
API. Use the Sites/Cloudflare deployment for the backend-backed feed.

## Development

```bash
npm install
npm run dev
```

## Builds

```bash
npm run build
npm run build:pages
```

- `npm run build` builds the full Sites/Cloudflare app.
- `npm run build:pages` builds the static GitHub Pages version into
  `dist-pages`.

## GitHub Pages

The `.github/workflows/pages.yml` workflow deploys the static version whenever
`main` is pushed.
