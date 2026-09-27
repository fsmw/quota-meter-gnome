# Evaluation rubric — Codex quota vertical slice

Evaluate in `code-only` mode plus a manual GNOME Shell review where available. Browser/Playwright is not an appropriate evaluator for an in-process Shell extension.

| Criterion | Weight | Passing evidence |
|---|---:|---|
| Protocol and normalization correctness | 0.30 | Correct initialize/initialized handshake, response-id correlation, notifications, all returned buckets, optional/null fields, timestamps and guarded remaining-percent derivation. Fixtures cover success and malformed/error responses. |
| Process and Shell lifecycle | 0.30 | Async Gio I/O only; single in-flight operation; timeout; disable closes/terminates/reaps child, clears timers and prevents late UI mutation. GNOME 50-compatible imports only. |
| UX and truthfulness | 0.20 | Panel is compact; menu names each window and its units/time; used vs remaining is unambiguous; absent/stale/auth-required states never become zero; experimental status is visible. |
| Security and reviewability | 0.20 | No auth.json/private HTTP/shell interpolation/raw response logging; bounded JSONL and redacted errors; adapter isolated; readable GJS; reference repositories unchanged. |

Score each criterion 1–10 with specific evidence. Weighted pass threshold: 7.0. Any private endpoint/auth-file use, unbounded/unreaped child process, synchronous Shell-blocking I/O, or false-zero quota is an automatic fail regardless of score.
