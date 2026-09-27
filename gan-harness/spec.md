# GAN spec — Quota Meter Codex quota MVP

## Product goal

An installable GNOME Shell 50+ extension for personal use that displays official Codex ChatGPT quota in the top bar and in a compact menu. This release is personal/experimental. It is an unofficial community integration over the local Codex App Server client protocol; that protocol can evolve and is not a general-purpose public REST API.

## Locked scope

- GJS extension and GSettings preferences, no runtime npm dependencies.
- Codex is the first and required integration. Use official `codex app-server` over default stdio JSONL. Initialize the JSON-RPC session and request `account/rateLimits/read`.
- Keep Codex auth under Codex CLI ownership. Never read `~/.codex/auth.json`, call the private `/wham/usage` endpoint, scrape, or automate UI.
- Keep quota separate from optional local session usage. No Claude quota, Gemini, OpenAI API Platform, or DeepSeek in this MVP.
- Keep the App Server client behind a narrow adapter. Never log raw protocol lines, stderr, credentials, or full errors.
- All subprocess and UI lifecycle work is asynchronous; disable cancels, closes, terminates and reaps child process and clears UI/timers.

## MVP vertical path

An App Server JSONL fixture emits a valid multi-window rate-limit snapshot → strict protocol reader correlates response by id and handles notifications → normalizer returns typed quota metrics → coordinator updates panel summary and menu rows → user sees `usedPercent`, derived remaining percentage, window duration/reset, last fetched time and provider state.

## Failure states

Codex CLI absent, spawn failed, auth required, timeout, process exit, JSON-RPC error, malformed/oversized JSONL, invalid percentage, stale last-good snapshot, unavailable quota fields. No failure should block Shell or be presented as 0% used.

## Operational defaults

Immediate first refresh; 5-minute polling; one in-flight request; 8-second timeout; 60-second manual refresh cooldown; 30-minute in-memory stale cache; bounded exponential backoff; honor protocol/service error and avoid tight retries. Disable cancels all resources.

## Out of scope

Claude personal quota; Gemini products; local observed-usage parser; API Platform usage; provider secrets/preferences; multi-account support; production support claim; Extensions.gnome.org approval.
