# CLAUDE.md: Deadswitch

Read this whole file before doing anything. It's the brief for building the web app and the reminder service. The smart contract is finished and tested; don't change it.

## 1. What Deadswitch is

A plan for your crypto, built on NEAR Intents only.

- The owner keeps their funds in **their own NEAR Intents account** (`intents.near`). Nothing is locked.
- The owner registers one extra key on that Intents account: the **estate key**, derived by NEAR Chain Signatures from the Deadswitch contract account plus the path `estate:intents`. Nobody holds its private half; only the MPC network (`v1.signer`) signs with it, and only when the contract asks.
- **If the owner stops checking in**, the timer runs out and anyone can call `sweep`: the contract writes one transfer intent paying each heir their share straight from the owner's Intents account, has it signed by MPC, and submits it to `intents.near`.
- **Panic button:** the owner can execute the plan immediately with `send_now`.
- **Check-ins:** on the website (connect wallet, press "Check in"), or one tap on an email/Telegram reminder. Reminder check-ins go through a **check-in operator** account that pays its own gas.
- **Changes that add power wait** for a change delay; **changes that remove power are immediate.**

Read `README.md` for the full picture and `src/lib.rs` for the contract.

## 2. Hard rules (safety)

1. **Ask before every mainnet transaction.** Show the exact command or call and wait for an explicit yes. This includes `near call`, `near deploy`, `near send-near`, `near delete-account`, and any code path that signs and sends.
2. **Never read, print, copy or move anything in `~/.near-credentials/`.** Never put a private key in code, logs, commits or chat. Secrets go only in `.env` files that are gitignored; ask the user to paste values into `.env` themselves.
3. **Don't modify the contract** (`src/lib.rs`, `Cargo.toml`, `history/`) or redeploy it unless the user explicitly asks.
4. **Never delete or recreate NEAR accounts.**
5. Add `web/.env`, `service/.env`, `service/data/` and `node_modules/` to `.gitignore` before the first commit that touches them.
6. Commit in small steps with clear messages; push only when the user asks.

## 3. Current state (mainnet)

| Item | Value |
| --- | --- |
| Network | NEAR mainnet |
| Contract (v5) | `deadswitch.thalderg.near` |
| Owner | `thalderg.near` (in the user's Meteor wallet and the NEAR CLI) |
| Heirs | `anna.thalderg.near` 70%, `marco.thalderg.near` 30% |
| Check-in operator | `checkin.thalderg.near` (already allowed in the contract) |
| MPC signer | `v1.signer` |
| Intents | `intents.near` |
| Estate key | `ed25519:DDLPgZdqFXsG1g7vtwtAvegPAYs4SzLfmT8fWaRJRSZc` (registered on `thalderg.near`'s Intents account) |
| Deploy settings | timeout 86400 s, timer on, panic on, change delay 60 s, operator interval 60 s |

The NEAR CLI on this Mac is the JavaScript `near-cli` (v4 syntax: `near call <contract> <method> '<json>' --useAccount <acc> --networkId mainnet`).

A working NEAR wallet-connection example that ran on this Mac with Meteor is in `~/near-multichain` (Vite + React). Reuse its wallet-connection approach. Note that its Sepolia RPC was changed to `https://ethereum-sepolia-rpc.publicnode.com` because the default was down; irrelevant here, but don't be surprised.

## 4. Contract interface (v5)

All amounts are strings in the token's smallest unit. wNEAR (`nep141:wrap.near`) has 24 decimals: `100000000000000000000000` = 0.1.

**Views** (free):
- `status()` returns owner, heirs `[{account_id, share_bps}]`, timeout_secs, last_ping_ns, deadline_ns, now_ns, triggered, estate_path, estate_public_key, timer_enabled, panic_enabled, change_delay_secs, pending_testament, pending_modes, checkin_operator, pending_operator, operator_min_interval_secs, last_operator_checkin_ns. Times are nanoseconds as strings.
- `preview_sweep({amount})` returns `[{account_id, amount}]`.
- `swept({token_id})` returns the total swept for a token.

**Owner calls** (signed by the owner's wallet, 30 Tgas, no deposit), all refused after the switch has triggered:
- `ping()`: check in.
- `set_testament({shares:[{account_id, share_bps}]})`: shares must add up to 10000; takes effect after the change delay.
- `cancel_pending_testament()`
- `set_modes({timer_enabled, panic_enabled})`: off applies at once; on waits for the delay. At least one must stay on.
- `cancel_pending_modes()`
- `set_checkin_operator({account_id})` (waits for the delay) / `remove_checkin_operator()` (immediate).
- `set_timeout({timeout_secs})`
- `set_estate_key({public_key})`
- `send_now({token_id, amount, salt})`: **300 Tgas**. Panic button; panic mode must be on.

**Operator call:**
- `operator_check_in()`: signed by `checkin.thalderg.near`, 30 Tgas. At most once per `operator_min_interval_secs`. Errors to handle: `Too soon...` (treat as "already checked in recently"), `check-ins are closed` (switch has triggered), `Only the check-in operator...`.

**Anyone:**
- `sweep({token_id, amount, salt})`: **300 Tgas**, only after the deadline, while the timer is on. The caller needs roughly 0.31 NEAR available because of gas prepayment (most is refunded).

**Supporting views and calls on other contracts:**
- Salt: `intents.near` view `current_salt({})` returns e.g. `"252812b3"` (pass it without quotes).
- Owner balance: `intents.near` view `mt_balance_of({account_id, token_id})`, or `mt_batch_balance_of({account_id, token_ids})`.
- Owner's tokens: try `intents.near` view `mt_tokens_for_owner({account_id})`. **Verify it exists** with one view call before relying on it; if it doesn't, keep a configured token list (`nep141:wrap.near` plus whatever the user adds).
- Estate key: `v1.signer` view `derived_public_key({path:"estate:intents", predecessor:"<contract>", domain_id:1})`.
- Register it: `intents.near` call `add_public_key({public_key})` signed by the owner, **deposit exactly 1 yoctoNEAR**. Check with view `has_public_key({account_id, public_key})` or `public_keys_of({account_id})`. Remove with `remove_public_key({public_key})`, also 1 yoctoNEAR.

## 5. What to build

Build in this order, so there's always something to demo. Ask the user before moving to the next part.

### Part A: Web app (`web/`)

Vite + React + TypeScript. Config through `web/.env`: `VITE_NETWORK=mainnet`, `VITE_CONTRACT_ID=deadswitch.thalderg.near`, `VITE_SERVICE_URL=http://localhost:8787`. One deployed contract, one owner, in this prototype.

**Screens**

1. **Landing (`/`)**: the marketing page (copy in section 7).
2. **Dashboard (`/plan`)**, for the connected owner:
   - Title "Your plan is active", or "Your plan has run" once triggered.
   - "You last checked in [relative time], from [the website | a reminder]." Then: "If you don't check in again, your plan runs on [date time UTC], in [time left]."
   - A thin progress track from the last check-in to the deadline.
   - A **Check in** button (see "Check-in from the website" below).
   - **Your NEAR Intents account:** balances for the configured tokens.
   - **Who receives what:** shares as bars, an "Edit plan" dialog (percentages that must total 100%), and a pending-change banner with time left and a "Cancel change" button.
   - **Reminders:** email and Telegram toggles, linking status, the schedule explained in one sentence, and an optional "Tell the people in my plan when it runs" with per-heir contact fields. These settings live in the service, not the contract.
   - **Settings:** the timer on/off, the panic button on/off, "Let reminders check me in" (the operator on/off), with the rule "Turning something off applies right away. Turning something on, or changing your plan, waits [change delay]."
   - **Move everything now:** a panic section in amber. It opens a confirmation dialog: title "Send everything to your plan?", body "This sends [amounts] to [heirs] now. It can't be undone.", buttons "Send everything" and "Keep my funds".
   - **Permission:** the estate key status (registered or not), with "Add permission" or "Remove permission".
3. **Setup (`/setup`)**, a first-run flow for an owner without the permission:
   1. Connect your wallet.
   2. Choose who receives what (calls `set_testament` if it differs from the current plan).
   3. Give the switch its permission (`add_public_key` on `intents.near`, then `set_estate_key` on the contract). Explain in one sentence that funds don't move.
   4. Reminders: email (verify with a 6-digit code) and/or Telegram (link through the bot). Both optional, with a warning if none is chosen: "Without reminders, only your own check-ins on this website keep your plan from running."
   5. Allow reminder check-ins (`set_checkin_operator`), explaining that it waits for the change delay.
4. **Heir view (`/heir`)**: "[owner] left a plan for you" once triggered, otherwise "This plan hasn't run." It lists the shares and preview amounts, has a **Carry out the plan** button (calls `sweep` per token with balance; the connected account pays gas), and explains how to withdraw on NEAR Intents.
5. **Check-in link page (`/checkin/:token`)**: served by the service; see Part B.

**Check-in from the website**

The user connects their wallet and presses **Check in**:
1. Ask the wallet for a free NEP-413 message signature (no transaction). Message: `Deadswitch check-in for <owner> at <ISO time>`, recipient `deadswitch`, with a random 32-byte nonce.
2. POST it to the service, `/api/checkin/wallet`. The service verifies the signature, checks via RPC (`view_access_key`) that the public key is a key of the owner's account, checks the message time is recent (within 5 minutes) and the nonce is unused, then calls `operator_check_in`. The user pays nothing.
3. If the wallet can't sign messages, or the operator is off or answered "Too soon", fall back to calling `ping()` with the wallet (the owner pays a tiny gas fee). Say so in the UI before signing.

**Design** (match exactly; this is the approved mockup):
- **Colors:** night `#10162A` (page), deep `#18213B` (surfaces), rule `#2A3556` (lines), moonlight `#EEF1F8` (text), mist `#A7B1C8` (secondary text), tide `#7FD1C1` (primary actions, safe states), ember `#F0A35E` (panic only). Pending or warning panel: background `#221F24`, border `#5B4A36`, text `#F6D9BC`.
- **Type:** Instrument Serif (Google Fonts, regular, sentence case) for headings and large statements; Geist for everything else. No all-caps labels, no pixel fonts.
- **Layout:** a left icon rail (76 px: logo mark, then Home, Your plan, Who receives what, Move everything now, How it works), with content max-width 1200 px. Surfaces have radius 28 px; buttons are pill-shaped (min height 44–50 px). Primary buttons are tide with night text; secondary buttons are transparent with a rule border.
- **Hero illustration:** an SVG of a tangled knot of thin lines (ember, mist and moonlight at low opacity) flowing into a glowing tide ring with a check mark, then three clean tide curves to "Anna 50%", "Marco 30%" and "A cause you care about 20%". Generate the tangle procedurally with a fixed seed.
- **Tone:** calm and respectful. No game metaphors, no "game over", no hearts.
- **Quality floor:** responsive down to 360 px, visible keyboard focus, `prefers-reduced-motion` respected, WCAG AA contrast.

### Part B: Reminder service (`service/`)

Node + TypeScript, one process. It's an HTTP server (port 8787) plus a scheduler loop. Storage is SQLite (`service/data/deadswitch.db`, gitignored). Config in `service/.env` (gitignored):

```
NETWORK=mainnet
CONTRACT_ID=deadswitch.thalderg.near
OWNER_ID=thalderg.near
OPERATOR_ACCOUNT_ID=checkin.thalderg.near
OPERATOR_PRIVATE_KEY=            # the user pastes it; never print it
RESEND_API_KEY=                  # email via Resend
EMAIL_FROM=
TELEGRAM_BOT_TOKEN=
PUBLIC_BASE_URL=http://localhost:8787
SITE_URL=http://localhost:5173
TOKENS=nep141:wrap.near
DEMO_REMINDER_OFFSETS_SECONDS=   # e.g. "300,120" for the demo; empty = real schedule
DRY_RUN=true                     # log instead of sending transactions until the user says otherwise
```

**Reminder schedule** (based on time left until `deadline_ns`):

| Time left | Send a reminder |
| --- | --- |
| more than 30 days | once a month |
| 30 to 7 days | once a week |
| 7 to 2 days | every 2 days |
| last 2 days | once a day |

Never send more than one reminder per day. A check-in resets the schedule. If `DEMO_REMINDER_OFFSETS_SECONDS` is set, send exactly one reminder at each offset before the deadline instead. Write unit tests for the schedule function.

**Reminder message** (email and Telegram), with all values computed per message:

> Your plan runs on [14 December 2026 at 09:14 UTC], in [30 days].
>
> If you're still here, confirm below and the timer resets to [12 months].
>
> [I'm still here]
>
> This link works until your next reminder on [date]. *(If none: "This is your last reminder before your plan runs.")*
> You can also check in any time on the website: [SITE_URL]
>
> Check-ins from reminders are free.
> This link only checks you in. It never asks you to connect a wallet or sign anything.

- **Email subject:** "Your Deadswitch plan runs in [time left]".
- **Telegram:** the same text, with an inline button "I'm still here" (callback data = one-time token).

**One-time check-in links**
- A random 32-byte token. Store only its SHA-256 hash, tied to the owner. It expires when the next reminder is sent, and is single use.
- `GET /checkin/:token` shows a confirmation page in the site design with one button, **Check in**. **Don't check in on GET**, because email security scanners open links automatically.
- `POST /checkin/:token` verifies the token, calls `operator_check_in`, marks it used, and shows: "You're checked in. Your plan now runs on [date], in [time]." For "Too soon", show "You're already checked in. Your plan runs on [date]."

**Telegram linking:** the site shows a deep link `https://t.me/<bot>?start=<one-time code>`. The bot's `/start <code>` stores the chat id for that owner. The button's callback is handled exactly like POST `/checkin/:token`.

**Email verification:** send a 6-digit code, valid for 15 minutes; store the email only after verification.

**At the deadline** (when `status().triggered` is true):
1. For each configured token, read the owner's balance. If it's above 0, call `sweep` (operator account, 300 Tgas) with the current salt.
2. Log each transaction hash.
3. If the owner enabled it, notify each heir: "[owner]'s plan has run. You received [amount] in your NEAR Intents account. To withdraw it to your own wallet, visit [near-intents.org or SITE_URL/heir]."
4. Don't retry a sweep that failed more than 3 times; log loudly instead.

**Endpoints for the web app:** `GET /api/settings`, `POST /api/settings`, `POST /api/email/start`, `POST /api/email/verify`, `POST /api/telegram/link`, and `POST /api/checkin/wallet` (see Part A). Authenticate settings changes with the same NEP-413 signed-message check.

All transactions go through a single function that respects `DRY_RUN`, logs the call, and returns the transaction hash.

### Part C: Demo setup

The goal is a 2–3 minute video showing the whole flow, using real mainnet transactions, with the user's approval for each.
- Set the timer to 10 minutes (the owner calls `set_timeout({timeout_secs:600})`), and set `DEMO_REMINDER_OFFSETS_SECONDS=300,120`.
- Show:
  1. the landing page,
  2. the setup or dashboard,
  3. a reminder arriving by email and Telegram,
  4. tapping "I'm still here" and the dashboard updating,
  5. letting the timer run out,
  6. the automatic sweep,
  7. the heirs' balances and notification,
  8. the transactions on nearblocks.io.
- Optional: a few dollars of real SOL or ETH deposited into `thalderg.near`'s Intents account, added to `TOKENS`, so the sweep moves a non-NEAR asset too.

## 6. Definition of done

- `web/`: all screens working against mainnet with the user's wallet; `npm run build` passes.
- `service/`: reminders, one-time links, Telegram, wallet check-in, automatic sweep and heir notifications; the schedule is unit-tested; it runs with `npm run dev`.
- READMEs in `web/` and `service/` with setup steps, and the root `README.md` status boxes ticked for what's done (ask the user first).
- No secrets in Git.

## 7. Landing page copy (approved)

- **Headline:** In crypto, your capital is at risk every day.
- **Sub:** Give it a plan. Your funds stay in your own NEAR Intents account, and if anything happens to you or your keys, everything goes exactly where you chose.
- **Buttons:** "Set up my plan", "See how it works".
- **Section "What could go wrong, and what happens instead":**
  - *Someone gets hold of your keys.* Press one button and your funds move to the wallets you picked in advance, before anyone else can take them.
  - *Someone forces you to hand over access.* Your plan can't be rewritten in a hurry. Every change waits 48 hours, and you can cancel it.
  - *You lose access to your own wallet.* Add a backup wallet of yours to the plan. When the timer runs out, your funds go there.
  - *You're gone, and nobody can reach your crypto.* If you stop checking in, the people you chose receive their shares. No seed phrase changes hands.
  - *You don't want to trust a company with your money.* Nothing is locked and nobody holds it for you. Your funds stay in your account until the moment they move.
- **Section "Peace of mind now. An impact that outlasts you."**
  - *While you're here:* Use your funds as you always do; trading, swapping and withdrawing keep working. Reminders arrive by email or Telegram, timed to your plan, and one tap checks you in: no wallet, no fees. If your keys are ever at risk, one button moves everything to safety.
  - *When you're gone:* Everything goes where you want it to go: family, friends, or a cause you care about. Each person receives their share in their own account, ready to withdraw to their own wallet. Your crypto keeps doing good after you, instead of being lost forever.
- **Section "Set it up once, then forget about it"** (numbered steps):
  1. Choose who receives what.
  2. Give the switch one permission (your funds don't move, and you can remove it any time).
  3. Keep living your life (we remind you before your timer runs out; tap "I'm still here" or check in on the website).
- **"Works with what you hold in NEAR Intents":** NEAR, Bitcoin, Ethereum, Solana, USDC, and every other token NEAR Intents supports.
- **"Built so nobody has to be trusted":** No one holds the key. The rules are public. You stay in control.
- **Footer:** "Built at NEAR HACKATHON on NEAR Intents and Chain Signatures." / "A prototype, not a legal will."

## 9. Pricing (copy and behaviour)

- Nothing is charged in this prototype. Don't build any payment flow.
- Landing page: include the "Free during the beta" section from `design/landing.html` ("After the beta, reminders by email and Telegram will cost about $10 a year, payable in USDC or any NEAR Intents token. Checking in is always free for you: we pay the network fee.").
- Dashboard, Reminders section: a short line "Free during the beta."
- Website check-in: free for the user (signed message, operator pays). Only the `ping()` fallback costs the user gas; say so before asking the wallet to sign.
- The operator account (`checkin.thalderg.near`) pays all check-ins and the automatic sweep. Show its NEAR balance in the service logs at startup, and warn in the logs when it drops below 0.1 NEAR.
