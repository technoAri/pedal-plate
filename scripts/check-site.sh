#!/usr/bin/env bash
# Sanity checks for the static site: each page must be a complete HTML
# document, and every local asset it references must exist.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
for page in index.html card.html; do
  [ -f "$page" ] || { echo "$page missing"; fail=1; continue; }

  for tag in '<!DOCTYPE html>' '<html lang=' '<head>' '</head>' '<body>' '</body>' '</html>' '<title>'; do
    grep -qi -- "$tag" "$page" || { echo "$page: missing $tag"; fail=1; }
  done

  # Local src/href/srcset targets (skip absolute URLs, anchors, mailto/tel, routes).
  { grep -oE '(src|href)="[^"]+"' "$page" | sed -E 's/^(src|href)="([^"]+)"$/\2/'
    grep -oE '(srcset|imagesrcset)="[^"]+"' "$page" | sed -E 's/^[a-z]+="([^"]+)"$/\1/' | tr ',' '\n' | awk '{print $1}'
    grep -oE 'url\(/[^)]+\)' "$page" | sed -E 's/^url\(\/?([^)]+)\)$/\1/'
  } | sed -E 's#^/##; s/[?#].*$//' | sort -u |
    grep -vE '^(https?:|//|mailto:|tel:|_vercel/|privacy$|card$|$)' |
    while read -r path; do
      [ -f "$path" ] || { echo "Missing asset referenced in $page: $path"; exit 1; }
    done || fail=1
done

[ "$fail" -eq 0 ] && echo "Site checks passed." || exit 1
