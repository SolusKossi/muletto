# Muletto - web app

The public site. Multi-page, static, dependency-free, and client-side by design:
opening an export reads the file in the browser and never uploads it.

Design direction: light "Sleek modern SaaS" (Inter, indigo accent, generous
spacing). The wordmark uses Baloo 2, embedded as base64 in `styles.css` so there
is no external request.

## Pages

| File | What it is |
| --- | --- |
| `index.html` | Marketing home: hero, product, privacy, pricing |
| `guides.html` | Export-guide directory + per-guide detail |
| `app.html` | The opener tool: drop an export, see an overview |
| `styles.css` | Design system + embedded wordmark font |
| `app.js` | Page-aware: guides rendering, the opener, duplicate detection |
| `guides/*.json` | Guide content (schema in `guides/guides.schema.json`) |

`app.js` initializes only the pieces present on each page, so one script serves
all three.

## Run locally

Any static file server works (the guides load over `fetch`, which browsers block
on `file://`):

```
python -m http.server 5173
```

Then open http://localhost:5173.

## Adding / verifying a guide

1. Copy an existing `guides/<slug>.json` and edit the steps.
2. Add a row to `guides/index.json` with an `icon` key (provider brand mark).
3. Walk every step yourself against a real account, then set `"verified": true`
   with your name and the date. A guide only shows the "Verified" badge once that
   flag is set.

## Next steps

- Per-provider parsers (adapters) to turn an export into a browsable library.
- zip64 support for multi-gigabyte archives.
