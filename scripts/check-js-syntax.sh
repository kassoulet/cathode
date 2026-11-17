#!/usr/bin/env bash
# node --check every JS/MJS file passed in (prek hands over the changed ones).
set -eu
for f in "$@"; do node --check "$f"; done
