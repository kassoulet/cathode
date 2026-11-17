#!/usr/bin/env bash
# Assemble the static GitHub Pages site into ./_site, mirroring the repo layout
# so the apps' relative imports (../src, ../node_modules, ../../assets) work.
set -euo pipefail
cd "$(dirname "$0")/../.."
rm -rf _site
mkdir -p _site/js/node_modules _site/assets
cp -r js/src js/compare js/benchmark js/demo _site/js/
cp -r js/node_modules/crt-shader _site/js/node_modules/
cp -r assets/crt _site/assets/
cat > _site/index.html <<'HTML'
<!doctype html>
<meta charset="utf-8"><title>crt-canvas</title>
<meta http-equiv="refresh" content="0; url=js/compare/">
<a href="js/compare/">Comparison app</a> · <a href="js/benchmark/">Benchmark</a> · <a href="js/demo/">Demo</a>
HTML
touch _site/.nojekyll
