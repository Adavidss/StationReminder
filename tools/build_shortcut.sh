#!/bin/sh
# Convert the committed XML plist to a signed, importable .shortcut file.
# Signing requires macOS 12+ (/usr/bin/shortcuts). Re-run after editing the plist.
set -eu
cd "$(dirname "$0")/.."

SRC=shortcut/StationReminder-Ding.plist
OUT=shortcut/StationReminder-Ding.shortcut
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

plutil -lint "$SRC"
plutil -convert binary1 -o "$TMP/ding.shortcut" "$SRC"
rm -f "$OUT"
/usr/bin/shortcuts sign --mode anyone --input "$TMP/ding.shortcut" --output "$OUT"
echo "Signed: $OUT"
