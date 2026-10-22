#!/usr/bin/env bash
# Prepare a street photo for the "From the Streets" section:
# 4:5 crop, gentle night grade, optional blur boxes (payment QR codes),
# metadata stripped, WebP at 400/720/1080px into images/streets/.
#
# Usage: scripts/process-photo.sh <input.jpg> <name> [crop-top-px] [x:y:w:h ...]
#   crop-top-px  pixels trimmed from the top before the 4:5 crop (default 0)
#   x:y:w:h      areas to blur, in source pixels (e.g. a UPI QR on the cart)
set -euo pipefail
src=${1:?input photo}; name=${2:?output name}; y=${3:-0}; shift $(( $# < 3 ? $# : 3 ))
cd "$(dirname "$0")/.."
GRADE="eq=contrast=1.1:saturation=1.16:brightness=0.015:gamma=1.07,colorbalance=rm=0.025:bm=-0.025:bs=0.02,unsharp=5:5:0.35,vignette=angle=0.32"
read -r W H < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$src" | tr , ' ')
ch=$(( W*5/4 )); [ $(( y+ch )) -le "$H" ] || { echo "crop-top too large (max $(( H-ch )))"; exit 1; }
pre="[0:v]null[b0]"; i=0
for box in "$@"; do
  IFS=: read -r bx by bw bh <<<"$box"
  m=$(( bw<bh ? bw : bh )); r=$(( m/4 < 28 ? m/4 : 28 ))
  pre="$pre;[b$i]split[m$i][c$i];[c$i]crop=$bw:$bh:$bx:$by,boxblur=$r:3[z$i];[m$i][z$i]overlay=$bx:$by[b$((i+1))]"; i=$((i+1))
done
mkdir -p images/streets
for w in 400 720 1080; do
  ffmpeg -loglevel error -y -i "$src" -filter_complex "$pre;[b$i]crop=$W:$ch:0:$y,$GRADE,scale=$w:-2:flags=lanczos[o]" \
    -map "[o]" -map_metadata -1 -c:v libwebp -quality 70 -compression_level 6 "images/streets/street-$name-$w.webp"
done
ls -l images/streets/street-"$name"-*.webp
