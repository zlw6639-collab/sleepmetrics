# Getting the numbers onto your phone — without handing them to anyone

> This library computes; it never sends. It contains no network code at all (`NON-GOALS.md` §4).
> This document is about the layer that *does* send — because "push my sleep report to my phone" is a
> question every user eventually asks, and the honest answer is that **most of the obvious options
> quietly break the property you actually wanted.**

## The one question that decides everything

> **Does the message travel through a server you do not control?**

Everything else (ease of setup, app quality, whether it needs an account) is secondary. Answer that
question first, because the answer is not visible in any marketing page.

| Option | Whose server carries the message? | Actually private? |
|---|---|---|
| **Self-hosted [ntfy](https://docs.ntfy.sh/) + F-Droid client** | Only yours (F-Droid build connects straight to your server; no Google services) | ✅ |
| **Self-hosted [Gotify](https://gotify.net/)** | Only yours (the project ships no hosted service at all) | ✅ |
| **Home Assistant Companion — [Local Push](https://companion.home-assistant.io/docs/notifications/notification-local/)** | Only yours — the official docs state it uses the **WebSocket API, not APNs/FCM** | ✅ |
| **Self-hosted Matrix (Synapse, no federation)** | Only yours | ✅ |
| Self-hosted ntfy **with the Google Play app** | Yours *and* **Google FCM** (the Play build routes through Firebase) | ❌ |
| Telegram Bot | Telegram's servers (messages are stored in Telegram's cloud) | ❌ |
| Discord / Slack webhook | Discord's / Slack's servers | ❌ |
| 飞书 (Feishu/Lark) / 钉钉 (DingTalk) / 企业微信 custom bot webhook | **The vendor's servers** — enterprise self-hosting exists, but not for personal accounts | ❌ |
| Any vendor cloud health API (Oura, Garmin, Fitbit, Zepp) | The vendor's servers | ❌ |

**The general rule:** a webhook *is* an instruction to hand the content to someone else's server. There
is no "local-only" way to use one. If a setup has you POSTing to `…/bot/v2/hook/…`, the data has already
left.

⚠️ **Verified as of 2026-10.** Re-check the vendor's own documentation before relying on any row — this
area changes quickly, and several vendor privacy pages could not be fetched during compilation (they are
JS-rendered). Row-by-row sources are listed at the bottom.

## What nobody ships: the middle

If you search for "health data → phone notification", you will find working pieces on **both ends** and
**nothing in between**:

```
 Garmin / Xiaomi / Zepp  ──►  Gadgetbridge  ──►  [ ??? ]  ──►  ntfy  ──►  your phone
   (vendor app)              (local DB,            ↑
                              auto-export,      this part is yours to write:
                              intent API)       read → compute → POST
```

- **Left end — solved.** [Gadgetbridge](https://gadgetbridge.org/internals/automations/auto-export/)
  keeps everything local and offers auto-export (ZIP / SQLite / GPX / FIT) plus an intent API, including
  a `WokeUp` broadcast you can trigger on.
- **Right end — solved.** ntfy/Gotify accept a plain HTTP POST. No account, no SDK.
- **Middle — yours.** Reading the export, computing the metrics with this library, and posting a summary.
  That is the gap, and it is a genuinely small script — see below.

## Disciplines for that middle script

Because this is the one place in the pipeline that could send health data somewhere, three rules:

1. **Push a summary, never the records.** "SRI 74.3 · 7-night 70.7 · MSFsc 05:43" is useful on a lock
   screen; a nightly record dump is a second copy of your health history sitting on a push server.
2. **Compute locally, then send.** The library's whole design assumes the data never leaves your machine.
   Keep that ordering: *read → compute → send a number*, never *send → compute elsewhere*.
3. **Make failures visible.** A push that silently fails is worse than no push (same principle as
   `auditRecords()`): check the response status and print it.

## A copy-paste starting point

[`examples/push-ntfy.mjs`](https://github.com/zlw6639-collab/sleepmetrics/blob/main/examples/push-ntfy.mjs)
does exactly the middle: reads a standard record array, computes a handful of metrics with this library,
and POSTs a short summary to a topic on **your own** ntfy server.

```powershell
$env:NTFY_URL = "https://ntfy.example.com"; $env:NTFY_TOPIC = "sleep"
node examples/push-ntfy.mjs records.json
```

(No ntfy server yet? `docker run -p 80:80 -it binwiederhier/ntfy serve` is the whole setup.)

## Rate limits and retention — what was actually verified

Quoting a limit you did not read is how people end up with a silently truncated pipeline, so this
section separates **verified** from **not verified**.

**Verified (2026-10):**

- **ntfy.sh (the hosted service):** messages are cached for **12 h** and attachments for **3 h**, then
  deleted; the docs explicitly warn that *"server operators can log your messages"*. Rate limit on the
  hosted service: **60 messages burst, then 1 per 5 s**. Attachment size default **15 MB** (self-hosted
  instances can raise or disable these in config). Markdown, attachments, click-through, action buttons
  and priority levels are supported.
- **Slack webhooks:** roughly **1 message/second per channel** (short bursts tolerated), over-limit
  returns **HTTP 429 with `Retry-After`**; a hard **16 KB** limit per message, with the docs recommending
  ≤4000 characters.

**Not verified — do not quote these as fact:** Telegram and Discord official rate-limit and retention
texts (their domains were unreachable from the machine used for this survey), 飞书/钉钉/企业微信 limit
numbers (pages are JS-rendered), Bark's behaviour when self-hosted, licensing details for the
Mattermost / Rocket.Chat open-source editions, and the exact capabilities of Health Auto Export. Each of
these has an official page linked below; check it yourself rather than trusting a summary — including
this one.

## Sources

- ntfy — <https://docs.ntfy.sh/> · privacy and retention: <https://docs.ntfy.sh/privacy/>
- Gotify — <https://gotify.net/>
- Home Assistant Companion local push (WebSocket, not APNs/FCM) —
  <https://companion.home-assistant.io/docs/notifications/notification-local/>
- Gadgetbridge auto-export / intents —
  <https://gadgetbridge.org/internals/automations/auto-export/> · <https://gadgetbridge.org/internals/intents/>
- Slack rate limits — <https://docs.slack.dev/apis/web-api/rate-limits/>
- Apprise (multi-channel notification library) — <https://github.com/caronc/apprise>
- Bark (iOS) — <https://github.com/Finb/Bark> · self-hosted server: <https://github.com/Finb/bark-server>
- Healthchecks — <https://healthchecks.io/docs/self_hosted/>
- Telegram Bot API — <https://core.telegram.org/bots/api>
- 飞书 custom bot — <https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot>
- 钉钉 custom bot — <https://open.dingtalk.com/document/group/custom-robot-access>
- 企业微信 message push — <https://developer.work.weixin.qq.com/document/path/91770>

> **Why this file lives in a metrics library.** Because the alternative is that users discover the
> webhook problem *after* their sleep history is on someone else's server. The library refuses to do
> networking (`NON-GOALS.md` §4) — this page exists so that refusing it doesn't leave a vacuum.
