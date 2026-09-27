#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
extension_dir="$repo_root/extension"
uuid="quota-meter@fsmw.github.io"
user_extensions="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
target="$user_extensions/$uuid"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/quota-meter-nested.XXXXXX")"
backup="$temp_dir/previous-install"
schema_compiled="$extension_dir/schemas/gschemas.compiled"
schema_backup="$temp_dir/gschemas.compiled"
nested_config="$temp_dir/config"
dconf_profile="$temp_dir/dconf-profile"
previous_kind="none"
had_compiled_schema=false

cleanup() {
    if [[ -L "$target" ]]; then
        rm -f "$target"
    elif [[ -e "$target" && "$previous_kind" != "none" ]]; then
        rm -rf "$target"
    fi
    if [[ "$previous_kind" == "symlink" ]]; then
        mv "$backup" "$target"
    elif [[ "$previous_kind" == "directory" ]]; then
        mv "$backup" "$target"
    fi
    rm -f "$schema_compiled"
    if [[ "$had_compiled_schema" == true ]]; then
        mv "$schema_backup" "$schema_compiled"
    fi
    rm -rf "$temp_dir"
}
trap cleanup EXIT INT TERM

command -v dbus-run-session >/dev/null || { printf '%s\n' 'Falta dbus-run-session' >&2; exit 1; }
command -v gnome-shell >/dev/null || { printf '%s\n' 'Falta gnome-shell' >&2; exit 1; }
command -v glib-compile-schemas >/dev/null || { printf '%s\n' 'Falta glib-compile-schemas' >&2; exit 1; }
if [[ ! -x /usr/libexec/mutter-devkit ]]; then
    printf '%s\n' 'Falta Mutter DevKit; en Fedora se instala con: sudo dnf install mutter-devkit' >&2
    exit 1
fi

mkdir -p "$user_extensions"
if [[ -f "$schema_compiled" ]]; then
    cp -p "$schema_compiled" "$schema_backup"
    had_compiled_schema=true
fi
glib-compile-schemas "$extension_dir/schemas"

if [[ -L "$target" ]]; then
    previous_kind="symlink"
    mv "$target" "$backup"
elif [[ -e "$target" ]]; then
    previous_kind="directory"
    mv "$target" "$backup"
fi

ln -s "$extension_dir" "$target"
mkdir -p "$nested_config/dconf"
printf '%s\n' 'user-db:user' > "$dconf_profile"
printf '%s\n' "Iniciando GNOME Shell anidado. Cierra su ventana o pulsa Ctrl+C para salir."
printf '%s\n' "La extensión se habilita dentro de esa sesión con: gnome-extensions enable $uuid"

GDK_BACKEND=wayland \
XDG_CONFIG_HOME="$nested_config" DCONF_PROFILE="$dconf_profile" \
    dbus-run-session -- gnome-shell --wayland --devkit
