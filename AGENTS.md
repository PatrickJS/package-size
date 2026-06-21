# Package Size Agent Guide

This repo is a Node.js ESM project. Use Node 24 or newer, pnpm, `.js`/`.jsx`
source files, and explicit `.js` import extensions for local ESM imports.

Do not describe the reported size as full bundle cost. The app measures the
browser-resolved ESM artifact from `esm.unpkg.com` and reports raw, gzip, and
Brotli byte counts for that artifact.

Before handoff, run:

```bash
pnpm run release:check
```

