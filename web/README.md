# Deadswitch web app

Vite + React + TypeScript. Talks to the Deadswitch contract on NEAR mainnet, to NEAR Intents (`intents.near`) and the MPC signer (`v1.signer`) through read-only RPC calls, and to the reminder service (`service/`) for reminders and free check-ins. Wallets connect through [`@hot-labs/near-connect`](https://github.com/hot-dao/near-connect) (Meteor and others).

## Setup

```bash
cd web
cp .env.example .env     # adjust if needed; no secrets go in here
npm install
npm run dev              # http://localhost:5173
```

| Variable | Default | What it is |
| --- | --- | --- |
| `VITE_NETWORK` | `mainnet` | NEAR network |
| `VITE_CONTRACT_ID` | `deadswitch.thalderg.near` | The switch contract |
| `VITE_OPERATOR_ID` | `checkin.thalderg.near` | Check-in operator the settings toggle allows |
| `VITE_SERVICE_URL` | `http://localhost:8787` | Reminder service |
| `VITE_RPC_URL` | `https://free.rpc.fastnear.com` | NEAR RPC for read-only calls |
| `VITE_TOKENS` | `nep141:wrap.near` | Tokens always shown, besides what `mt_tokens_for_owner` returns |

Other commands: `npm run build` (type-check and production build), `npm test` (unit tests for formatting and share maths).

## Pages

| Path | What it does |
| --- | --- |
| `/` | Landing page, with the animated hero (coins → power-symbol pot → bonsai → outcomes) |
| `/plan` | Owner dashboard: countdown bar, plan health, balances, shares and edits, reminders, settings, travel mode, panic button, permission |
| `/setup` | First-run flow: plan, permission, reminders, reminder check-ins |
| `/heir` | What each person receives; **Carry out the plan** (`sweep` per token) once the switch has triggered |
| `/plan/summary` | Printable one-page summary for the owner's family papers (no keys) |

## How actions map to the contract

Every transaction is signed in the user's wallet; the app never holds keys.

- **Check in**: the wallet signs a free NEP-413 message (`Deadswitch check-in for <owner> at <ISO time>`, recipient `deadswitch`), posted to `POST /api/checkin/wallet`; the service calls `operator_check_in`. If the wallet can't sign messages, the service isn't reachable, the operator is off, or it answered "Too soon", the app explains the fee and offers `ping()` from the wallet.
- **Edit plan** → `set_testament` (waits for the change delay); **Cancel change** → `cancel_pending_testament`.
- **Settings** → `set_modes`, `cancel_pending_modes`, `set_checkin_operator` / `remove_checkin_operator`.
- **Travel mode** → `set_timeout` (trip + 2 weeks); the usual period is remembered in this browser and restored with one click.
- **Move everything now** → one `send_now` per token with a balance (300 Tgas each), with the current Intents salt.
- **Permission** → `add_public_key` on `intents.near` (1 yoctoNEAR) plus `set_estate_key`; removal → `remove_public_key`.
- **Carry out the plan** (heir page) → one `sweep` per token with a balance.

## Development preview

In `npm run dev` only, `?as=<account>` shows the app as that account, read-only (for checking layouts without a wallet). Nothing can be signed or sent in that mode, and it's absent from production builds.

## Design

Matches the approved mockup in `../design/v2-mockup.html`. The hero scene lives in `src/components/hero-scene.ts` (ported from the mockup).
