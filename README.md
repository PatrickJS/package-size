# Package Size

A local package-size checker for browser-resolved npm artifacts. It resolves a
package through `esm.unpkg.com`, downloads the resolved artifact or metadata,
and reports raw, gzip, and Brotli byte counts.

This is intentionally not a full dependency bundle analyzer. It measures the
single browser ESM artifact, or metadata response, that `esm.unpkg.com` resolves
for the requested package spec and options.

## CLI

```bash
package-size json react
package-size json @scope/package@1.2.3 --target es2020 --condition browser --min
package-size dashboard --open
```

`package-size json <package-spec>` prints compact JSON:

```json
{"ok":true,"result":{"query":"react","package":"react","version":"19.2.7","rawBytes":20689,"gzipBytes":4735,"brotliBytes":4171}}
```

Supported JSON options:

```text
--subpath <path>
--target <target>
--condition <name>
--env production|development
--dev
--bundle
--standalone
--no-bundle
--min
--sourcemap
--meta
```

`package-size dashboard` starts the local web dashboard. Use `--host`, `--port`,
and `--open` to choose the listener and open the page.

## GitHub Pages Dashboard

The same dashboard can be published as a static GitHub Pages app. When the
Node.js API is unavailable, the browser fetches the resolved `esm.unpkg.com`
artifact directly, computes raw, gzip, and Brotli byte counts in the browser,
and stores resolved measurements locally with IndexedDB, falling back to
localStorage when needed.

Dashboard URLs are shareable. Use `pkg` for the package spec and the same
UNPKG options used by the builder, for example:

```text
https://patrickjs.github.io/package-size/?pkg=react&conditions=browser&target=es2022
https://patrickjs.github.io/package-size/?pkg=react&subpath=jsx-runtime&conditions=browser,react-server&target=es2020&meta
```

## Local Development

```bash
pnpm install
pnpm run dev
pnpm run pipeline:pages
pnpm run test
pnpm run build
pnpm run release:check
```

## API

```text
GET /api/size?pkg=react
GET /api/size?pkg=@scope/package@1.2.3
GET /api/size?pkg=react&target=es2020&conditions=browser,react-server&env=development&bundle=standalone&min=true
```

Optional query parameters mirror the CLI: `subpath`, `target`, repeated or
comma-separated `conditions`, `env`, `bundle`, `min`, `sourcemap`, and `meta`.

Successful responses return:

```json
{
  "ok": true,
  "result": {
    "query": "react",
    "requestUrl": "https://esm.unpkg.com/react?conditions=browser&target=es2022",
    "resolvedUrl": "https://esm.unpkg.com/react@19.2.7?conditions=browser&target=es2022",
    "package": "react",
    "version": "19.2.7",
    "options": {
      "subpath": "",
      "target": "es2022",
      "conditions": ["browser"],
      "env": "production",
      "bundle": "default",
      "min": false,
      "sourcemap": false,
      "meta": false
    },
    "rawBytes": 20689,
    "gzipBytes": 4735,
    "brotliBytes": 4171,
    "contentType": "application/javascript; charset=utf-8",
    "source": "esm.unpkg.com",
    "measuredAt": "2026-06-20T00:00:00.000Z",
    "warnings": [],
    "cacheHit": false
  }
}
```

## Local Data

- Recent searches are stored in browser localStorage.
- Measurements are cached on the local machine by the final resolved
  `esm.unpkg.com` URL. The local Node.js API uses a filesystem cache; the
  static dashboard uses IndexedDB or localStorage in the browser.
- Tags and semver ranges still resolve through `esm.unpkg.com`; exact resolved
  versions can use the local cache directly.
- Cache misses fetch the package artifact from `esm.unpkg.com`.
