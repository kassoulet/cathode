#!/usr/bin/env bash
# Fail if the given commit message file (or stdin: `-`) has a Co-authored-by trailer.
set -eu
file=${1:--}
if [ "$file" = - ]; then file=/dev/stdin; fi
if grep -qiE '^[[:space:]]*co-authored-by:' "$file"; then
  echo "error: commit message has a Co-authored-by trailer; remove it." >&2
  exit 1
fi
