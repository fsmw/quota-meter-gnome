# Notes for an Extensions.gnome.org review

## Why Quota Meter starts Codex CLI

The product requirement is to display the quota attached to the user's ChatGPT plan. OpenAI's [user-facing guidance](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) directs Codex users to the usage dashboard or `/status` in Codex CLI. The [OpenAI Usage API](https://platform.openai.com/docs/api-reference/usage) documents organization-level usage for the OpenAI API Platform, not the quota of a ChatGPT plan. Quota Meter therefore asks the user's installed Codex CLI to expose its locally authenticated account through its stdio App Server protocol and calls `account/rateLimits/read`.

This choice avoids reading or copying Codex credentials, reproducing Codex's HTTP traffic, using private endpoints, scraping pages, or automating a UI. The rate-limit RPC is present in the [current App Server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs) and does not carry the experimental opt-in marker; the protocol itself remains a local client interface without a third-party compatibility guarantee. Quota Meter labels the integration unofficial and personal, isolates it in `app-server-client.js` and `gio-transport.js`, and may need changes when Codex CLI evolves.

## External process safeguards

GNOME's [review guidance](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#scripts-and-binaries) strongly discourages external scripts and binaries, allowing them when they are unavoidable for an extension's purpose. Quota Meter does not distribute or install the Codex executable. It invokes only the user's existing `codex` binary with the fixed argument vector `['codex', 'app-server']`; it does not invoke a shell or use elevated privileges.

The transport:

- passes a small environment-variable allowlist;
- uses stdin/stdout JSONL pipes and silences stderr;
- limits protocol line size and never logs raw protocol messages;
- serializes refreshes and applies an 8-second request timeout;
- responds to extension cancellation, closes stdin, waits briefly for exit, then force-exits and reaps a stuck child.

The extension informs the user that Codex CLI must already be installed and authenticated. Without it, Quota Meter reports a clear unavailable state and leaves GNOME Shell responsive.

## Source provenance

`agtop/` and `gnome-system-monitor-indicator/` were inspected as read-only references. AgTop informed the product distinction between observed local activity and provider-reported quota, but its runtime and parsers were not copied. The system-monitor extension informed GNOME lifecycle and UI patterns; no substantial source blocks or assets were incorporated. An exact line comparison of the extension JavaScript against the tracked reference JavaScript found no shared block of five or more nonblank, non-comment lines. Short matches are standard GJS/GNOME patterns such as `GObject.registerClass`, panel lifecycle cleanup, and GTK preference imports.

The distributed code is licensed under GPL-2.0-or-later and uses a generic meter icon. The package includes the schema and license but excludes development scripts, design mockups, tests, and the reference checkouts.
