# Deadswitch reminder service

One Node + TypeScript process: an HTTP server (port 8787) and a scheduler loop. It sends reminders by email and Telegram, turns one-tap "I'm still here" links and the website's signed check-ins into `operator_check_in` calls, carries out the plan at the deadline (`sweep` per token), and tells the people in the plan. Storage is SQLite in `data/deadswitch.db` (gitignored).

It acts as the **check-in operator** `checkin.thalderg.near`, which can only reset the owner's timer (once per interval) and call `sweep` after the deadline, like anyone. It pays the gas for both.

## Setup

Requires Node 22.5 or newer (built-in `node:sqlite`).

```bash
cd service
cp .env.example .env      # then paste your own secrets into .env (never commit it)
npm install
npm run dev               # http://localhost:8787, restarts on changes
```

What to put in `.env`:

| Variable | What it is |
| --- | --- |
| `OPERATOR_PRIVATE_KEY` | Private key of `checkin.thalderg.near` (`ed25519:…`). Needed only when `DRY_RUN=false`. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email through [Resend](https://resend.com). `EMAIL_FROM` must be on a domain verified in Resend, e.g. `Deadswitch <reminders@yourdomain.com>`. |
| `TELEGRAM_BOT_TOKEN` | A bot from [@BotFather](https://t.me/BotFather). The service long-polls Telegram, so no public URL is needed. |
| `PUBLIC_BASE_URL` | Where the service is reachable; used in the check-in links in emails. |
| `SITE_URL` | The website; also the only non-localhost origin allowed to call the API. |
| `TOKENS` | Tokens to watch besides what `mt_tokens_for_owner` lists. |
| `DEMO_REMINDER_OFFSETS_SECONDS` | e.g. `300,120` for the demo. Empty means the real schedule. |
| `DRY_RUN` | `true` (default): transactions are logged, not sent. Set `false` only when you decide to go live. |

`npm test` runs the unit tests (the schedule, and NEP-413 signature checks). `npm run typecheck` checks types.

## Reminder schedule

Anchored to the deadline, so the last reminders always come before it:

| Time left | Reminders |
| --- | --- |
| more than 30 days | once a month (30, 60, 90… days before) |
| 30 to 7 days | once a week (28, 21, 14, 7 days before) |
| 7 to 2 days | every 2 days (6, 4 days before) |
| last 2 days | once a day (2, 1 days before) |

A check-in resets the schedule, and two reminders are never less than a day apart. With a check-in period of 1 day or less there is no reminder time after the check-in, so none is sent; use the demo offsets for short timers. Each reminder carries a new one-time link that works until the next reminder (or the deadline); older links stop working.

## Endpoints

| Method and path | Used by | What it does |
| --- | --- | --- |
| `GET /api/settings?owner=` | website | Reminder settings (email masked), last check-in source, next reminder |
| `POST /api/settings` | website | Changes toggles and heir contacts; needs a signed message |
| `POST /api/email/start`, `POST /api/email/verify` | website | Sends and checks a 6-digit code (15 minutes, 5 tries); the email is stored only after verification |
| `POST /api/telegram/link` | website | Returns `https://t.me/<bot>?start=<one-time code>` |
| `POST /api/checkin/wallet` | website | Free website check-in: verifies the signed message, then `operator_check_in` |
| `GET /checkin/:token` | email link | Shows a page with one **Check in** button (never checks in on GET: email scanners open links) |
| `POST /checkin/:token` | that button | Uses the one-time link and checks in |
| `GET /api/health` | anyone | `{ ok, dryRun }` |

**Signed messages** (NEP-413, from the owner's wallet): the text must be `Deadswitch check-in for <owner> at <ISO time>` (or `Deadswitch settings for …`), recipient `deadswitch`, signed less than 5 minutes ago, with a 32-byte nonce that hasn't been used before. The signature is checked, and RPC must confirm the key is a full-access key of the owner's account.

## At the deadline

When `status().triggered` is true, the scheduler reads the owner's balance of every token, calls `sweep` with the current salt for each one above 0, logs each transaction hash, and stops retrying a token after 3 failures (logged loudly; anyone can still carry out the plan on the website's `/heir` page). Once something has moved, and if the owner turned it on, each person in the plan with a contact gets a message with what they received. Email contacts always work; Telegram contacts (`@username`) work only if that person has written to the bot once.

## Operator balance

The operator's NEAR balance is logged at startup and checked hourly, with a warning below 0.1 NEAR.
