# Contributing

Thanks for helping! Issues and pull requests are welcome.

```bash
cd js && npm ci
npm test              # unit tests (node:test)
npm run demo          # serves http://localhost:8080/js/compare/ (comparison app) and /js/examples/
cd .. && prek install # git hooks: hygiene, node --check, no Co-authored-by trailers
```

- Keep it dependency-free at runtime; the library ships plain ES modules, no build step.
- Add a test for logic you change, and a line to `js/CHANGELOG.md` under `[Unreleased]`.
- CI (`.github/workflows/ci.yml`) runs the hooks, tests, the extension build and an `npm pack` check.
- Shaders, masks and presets in `assets/crt/` come from Toddler-Boy/CRTEmulation-Data (CC0); send fixes for them upstream.

## Releasing the npm package (maintainers)

1. Update `js/CHANGELOG.md` and bump `version` in `js/package.json`.
2. Tag and push: `git tag lib-vX.Y.Z && git push origin lib-vX.Y.Z`.
3. `.github/workflows/publish.yml` tests, then runs `npm publish --provenance` (needs the `NPM_TOKEN` secret).

Tags `vX.Y.Z` (no `lib-` prefix) release the browser extension zips instead.
