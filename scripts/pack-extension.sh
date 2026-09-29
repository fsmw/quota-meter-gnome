#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
staging_dir="$(mktemp -d)"
trap 'rm -rf "$staging_dir"' EXIT

cp -a "$repo_root/extension/." "$staging_dir/"
cp "$repo_root/LICENSE" "$staging_dir/LICENSE"
mkdir -p "$repo_root/dist"

gnome-extensions pack "$staging_dir" \
    --extra-source=normalizer.js \
    --extra-source=jsonl.js \
    --extra-source=app-server-client.js \
    --extra-source=gio-transport.js \
    --extra-source=provider.js \
    --extra-source=session-usage-parser.js \
    --extra-source=session-usage-provider.js \
    --extra-source="$staging_dir/i18n.js" \
    --extra-source=LICENSE \
    --schema "$staging_dir/schemas/org.gnome.shell.extensions.quota-meter.gschema.xml" \
    --out-dir="$repo_root/dist" \
    --force
