#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
staging_dir="$(mktemp -d)"
trap 'rm -rf "$staging_dir"' EXIT

cp -a "$repo_root/extension/." "$staging_dir/"
mkdir -p "$repo_root/dist"

gnome-extensions pack "$staging_dir" \
    --extra-source=normalizer.js \
    --extra-source=jsonl.js \
    --extra-source=app-server-client.js \
    --extra-source=gio-transport.js \
    --extra-source=provider.js \
    --schema "$staging_dir/schemas/org.gnome.shell.extensions.agnome-top.gschema.xml" \
    --out-dir="$repo_root/dist" \
    --force
