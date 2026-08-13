---
name: API server build strategy
description: Why the API server dev script uses tsx instead of esbuild, and what the prod path looks like
---

## Problem

`pnpm run build` (esbuild) crashes with "The service was stopped" (OOM/SIGKILL) when bundling `mineflayer` + `discord.js` together. These packages are massive and their transitive deps exceed the container's memory budget during a full bundle.

## Solution (dev)

Dev script changed from:
```
NODE_ENV=development pnpm run build && pnpm run start
```
to:
```
NODE_ENV=development tsx src/index.ts
```

`tsx` runs TypeScript directly via esbuild's transform-only mode (no bundling), so memory usage stays low.

**Why:** tsx transforms files on-demand without producing a bundle; it never needs to hold the entire dep graph in memory at once.

**How to apply:** If the dev script ever needs to change, keep tsx for development. Do not revert to `pnpm run build && pnpm run start` without first adding mineflayer + discord.js to the externals list in `build.mjs`.

## Production

Production still uses esbuild via `build.mjs` with an extensive externals list. The prod build is triggered on deploy, where resource limits are higher. If prod builds also start failing, add `mineflayer` and `discord.js` (plus their `prismarine-*` sub-packages) to the `external` array in `build.mjs`.
