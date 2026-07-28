# Shiftdeck

Shiftdeck turns schedule photos into a phone-friendly work reference for shifts,
crew coverage, flights, and an automatically updating Apple Calendar.

## What Works On GitHub Pages

- Schedule photo upload and review
- Worker timeline and roster views
- Flight board views
- Device-local settings and a private calendar token
- One-time Apple Calendar subscription with automatic revision updates,
  stable event IDs, cancellation handling, and duplicate prevention

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
