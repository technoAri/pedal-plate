#!/usr/bin/env bash
# Sanity checks for the static site: every local asset referenced from
# index.html must exist, and the page must be a complete HTML document.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
[ -f index.html ] || { echo "index.html missing"; exit 1; }

for tag in '<!DOCTYPE html>' '<html lang=' '<head>' '</head>' '<body>' '</body>' '</html>' '<title>'; do
  grep -qi -- "$tag" index.html || { echo "index.html: missing $tag"; fail=1; }
done

# Local src/href/srcset targets (skip absolute URLs, anchors, mailto/tel).
{ grep -oE '(src|href)="[^"]+"' index.html | sed -E 's/^(src|href)="([^"]+)"$/\2/'
  grep -oE '(srcset|imagesrcset)="[^"]+"' index.html | sed -E 's/^[a-z]+="([^"]+)"$/\1/' | tr ',' '\n' | awk '{print $1}'
  grep -oE 'url\(/[^)]+\)' index.html | sed -E 's/^url\(\/?([^)]+)\)$/\1/'
} | sed -E 's#^/##' | sort -u |
  grep -vE '^(https?:|//|#|mailto:|tel:|_vercel/|privacy$)' |
  while read -r path; do
    [ -f "$path" ] || { echo "Missing asset referenced in index.html: $path"; exit 1; }
  done || fail=1

[ "$fail" -eq 0 ] && echo "Site checks passed." || exit 1
