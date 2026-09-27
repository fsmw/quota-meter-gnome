# Quota Meter

Quota Meter is an unofficial GNOME Shell extension that displays account usage limits for supported AI services in the top panel. Its source is published at [github.com/fsmw/quota-meter-gnome](https://github.com/fsmw/quota-meter-gnome).

## Current scope

The first provider is Codex. Quota Meter starts the Codex CLI installed by the user and reads account limits over its local stdio App Server protocol. Authentication remains managed by Codex CLI; the extension does not read its credential files or store access tokens. The indicator shows the remaining percentage, while the menu shows quota windows, reset times and connection status.

This is an independent community project and is not endorsed by or affiliated with OpenAI. It uses a generic GNOME meter icon. The Codex App Server is a local rich-client interface, not the OpenAI API Platform. Its current protocol separates a stable surface from explicitly experimental methods; the quota read method is not marked as requiring the experimental opt-in. OpenAI does not document this as a general-purpose public REST API for third-party extensions, so the Codex adapter stays isolated and may need updates if the CLI protocol changes.

Claude plan quota and Google/Gemini are outside the first release. OpenAI API usage and costs are separate from ChatGPT/Codex plan allowances.

## Reference repositories

- [`agtop/`](agtop/README.md) is a read-only reference for local session usage. Its existing changes are preserved.
- [`gnome-system-monitor-indicator/`](gnome-system-monitor-indicator/README.md) is a read-only reference for extension lifecycle, panel indicators, preferences and GSettings.

## Development

Requires GJS, GNOME Shell and an installed, authenticated Codex CLI.

```sh
npm test
npm run check
npm run pack
```

The extension bundle is written to `dist/quota-meter@fsmw.github.io.shell-extension.zip`.

To install it in the current user session:

```sh
gnome-extensions install --force dist/quota-meter@fsmw.github.io.shell-extension.zip
gnome-extensions enable quota-meter@fsmw.github.io
```

To uninstall:

```sh
gnome-extensions uninstall quota-meter@fsmw.github.io
```

### Nested GNOME Shell

On GNOME 49 and later, use Mutter DevKit to test without closing the host session:

```sh
npm run dev:nested
```

In a terminal inside the nested Shell window, enable the extension:

```sh
gnome-extensions enable quota-meter@fsmw.github.io
```

The script compiles the schema for the temporary session, links `extension/` into the extension directory and restores any previous installation when the nested window closes.

## License

Quota Meter is licensed under GNU GPL version 2 or, at your option, any later version. See [LICENSE](LICENSE).
