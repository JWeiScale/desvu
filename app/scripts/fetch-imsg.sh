#!/bin/sh
# Pinned public release. Only the read helper and its resource bundles are installed.
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
curl --fail --location --proto '=https' --tlsv1.2 'https://github.com/openclaw/imsg/releases/download/v0.15.9/imsg-macos.zip' -o "$staging/imsg.zip"
printf '%s  %s\n' '5d862ddbf900c36a3360d92467b51b2b7e852634fd05b544ba8489ee3946c63f' "$staging/imsg.zip" | shasum -a 256 -c -
unzip -q "$staging/imsg.zip" -d "$staging/unpacked"
mkdir -p "$app_dir/resources/imsg"
for item in imsg SQLite.swift_SQLite.bundle PhoneNumberKit_PhoneNumberKit.bundle LICENSE; do
  ditto "$staging/unpacked/$item" "$app_dir/resources/imsg/$item"
done
chmod +x "$app_dir/resources/imsg/imsg"
