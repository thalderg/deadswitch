# Deadswitch: a plan for your crypto, on NEAR Intents

*Built at NEAR HACKATHON. @NEARProtocol #NEARHackathon*

In crypto, your capital is at risk every day. Keys leak, people get forced to hand over access, wallets get lost, and when a holder dies their coins are often gone forever. The usual fixes are sharing a seed phrase with family or trusting a custodian.

**Deadswitch needs neither, and your funds never leave your account.**

- You keep your crypto in **your own NEAR Intents account**, fully available: trade, swap and withdraw whenever you want.
- You give the switch **one permission**: an extra key on your Intents account that **nobody holds**. Only NEAR's MPC network can sign with it, and only when the Deadswitch contract asks.
- **If you stop checking in**, your plan is carried out: each person you chose receives their share, straight from your account.
- **If your keys are at risk**, a panic button sends everything to the people in your plan immediately.
- **We remind you** by email or Telegram before your timer runs out. One tap checks you in: no wallet, no fees.

> A hackathon prototype, not a legal will.

---

## What it covers

Everything you hold in your NEAR Intents account. NEAR Intents holds real assets from many networks, so this includes NEAR (held as wNEAR, 1:1), BTC, ETH, SOL, USDC and other supported tokens, including yield-bearing tokens such as liquid staking tokens if Intents lists them.

Each person in the plan receives their share in their own Intents account and can withdraw it to their own wallet on that asset's network.

Deadswitch is built for **NEAR Intents only**, by design.

---

## How it works

1. **Protect.** You register the switch's key on your own Intents account (`add_public_key` on `intents.near`). NEAR Chain Signatures derive it from the Deadswitch contract's account and the fixed path `estate:intents`, so its private half never exists anywhere. Your funds don't move.
2. **Plan.** You choose who receives what, in percentages (the testament).
3. **Check in.** Either connect your wallet on the website and press **Check in**, or tap **I'm still here** in an email or Telegram reminder.
4. **If you stop checking in,** the timer runs out and the switch is **final**: you're locked out (this protects your heirs if your key is stolen after your death), and anyone can carry out the plan with `sweep`.
5. **Sweep.** The contract writes **one fixed intent** paying each heir their share straight from your Intents account, has the MPC network sign it, and submits it to `intents.near`. The contract writes the destinations itself from the testament, so nobody can redirect the funds. Nothing passes through the contract.

### Safety rules

- **No one holds the key.** The MPC network splits it across independent operators; a threshold must cooperate to sign, and the whole key never exists in one place.
- **Only the contract can use it.** Chain Signatures derive keys from the account that requests the signature: the Deadswitch contract, whose code decides when the key may sign.
- **The key only works inside NEAR Intents.** It can't touch your NEAR account or any wallet.
- **Changes that add power wait; changes that remove power are immediate.** Changing your testament, turning a feature on, or allowing a check-in operator waits for a change delay fixed at deploy (48 hours in real use). Turning a feature off or removing the operator applies at once. So someone holding your key can't quickly redirect your plan, and you have time to cancel.

### Three modes

Set at deploy and changeable later (off at once, on after the change delay):

| Mode | What it does |
| --- | --- |
| Timer only | Your plan runs if you stop checking in |
| Timer + panic button | Plus: you can send everything to your plan at any time |
| Panic button only | No timer; only you can send, whenever you decide |

---

## Check-ins and reminders

**How you check in**

- **On the website:** connect your wallet, then press **Check in**. Signing in alone doesn't check you in.
- **From a reminder:** tap **I'm still here** in an email or a Telegram message. No wallet, no signature, no fee.

**How a one-tap check-in works:** the owner allows a **check-in operator** (the Deadswitch reminder service) in the contract. When you tap a reminder, the service confirms it came from your linked email or Telegram, then calls `operator_check_in`. The operator:

- **pays its own gas**, so check-ins cost you nothing,
- **can only reset your timer**: it can't move funds, change your plan or act as you,
- is limited to **one check-in per interval** (24 hours in real use), so a faulty or compromised service can't spam,
- can never bring back a switch that has already triggered,
- can be removed by you at any time, with immediate effect.

The worst a compromised operator could do is delay your plan.

**Reminder schedule** (one rule based on time left, for any timer length):

| Time left | Reminders |
| --- | --- |
| More than 30 days | once a month |
| 30 to 7 days | once a week |
| 7 to 2 days | every 2 days |
| Last 2 days | once a day |

Each reminder shows how much time is left, the exact date and time the plan runs, when its link expires (at the next reminder), when the next reminder arrives, and a link to check in on the website. Real check-in links never ask you to connect a wallet or sign anything.

**Optional:** the people in your plan can be notified by email or Telegram when the plan runs, with what they received and how to withdraw it. Contact details are stored by the service, never on-chain.

---

## Business model

- **Reminders subscription:** email and Telegram reminders, plus free one-tap check-ins (the subscription covers the operator's gas).
- **Later: a small fee only when a plan is carried out**, a percentage of what's sent, written into the contract and shown before you sign up. Free while you're alive; earned only when the service does its job.

Both are planned; neither is charged in this prototype.

---

## The testament

**Today:** each person gets a percentage (basis points, adding up to 100%), applied to every token swept. Changes wait for the change delay and can be cancelled. A backup wallet of your own can be one of the "heirs", which turns the switch into recovery for a lost wallet.

**Next:**
- **Rules per asset**, for example "Anna gets the BTC, Marco the USDC".
- **Converting at payout**, since NEAR Intents can swap.
- **Delivery straight to an heir's own wallet** (Bitcoin, Ethereum, Solana) through NEAR Intents withdrawals, so heirs don't need a NEAR account.
- **Drafting from plain words** with a NEAR AI private model, confirmed by the owner. The AI never interprets the plan at payout time.
- **A private testament:** only a hash on-chain; the full plan encrypted with a key from NEAR's Confidential Key Derivation that only becomes available once the switch triggers, then executed in a secure enclave (TEE) that proves it matches the hash.

---

## Roadmap

- **Reminder service:** email and Telegram reminders on the schedule above, one-tap check-ins through the operator, automatic sweep at the deadline, optional messages to heirs. Then Discord and SMS.
- **Confidential payouts** with NEAR Confidential Intents, so nobody can see who inherited what. Together with the private testament: neither the rules nor the payouts are public.
- **Execution fee** as described in the business model.
- **One contract for many owners**, each with their own settings and estate key (path `estate:<owner>`), instead of one contract per owner.
- **Self-funded check-ins:** an optional capped deposit in your own switch that repays the operator per check-in, for people who'd rather not rely on the subscription.
- **Locked deployment:** deleting the contract's full-access keys so nobody can ever change the code.
- **Yield-bearing tokens** and per-asset rules in the testament.

---

## Contract API (v5)

| Function | Who | When | What it does |
| --- | --- | --- | --- |
| `new(owner, timeout_secs, heirs, mpc_contract, intents_contract, timer_enabled, panic_enabled, change_delay_secs, operator_min_interval_secs)` | contract account | once | Initialises the switch |
| `ping()` | owner | before trigger | Check in |
| `set_testament(shares)` / `set_heirs(heirs)` | owner | before trigger | New plan, after the change delay |
| `cancel_pending_testament()` | owner | before trigger | Cancels a waiting change |
| `set_modes(timer_enabled, panic_enabled)` | owner | before trigger | Off at once, on after the delay |
| `cancel_pending_modes()` | owner | before trigger | Cancels a waiting mode change |
| `set_checkin_operator(account_id)` | owner | before trigger | Allows an operator, after the delay |
| `remove_checkin_operator()` | owner | before trigger | Removes it at once |
| `operator_check_in()` | operator | before trigger | Resets the timer; once per interval |
| `set_timeout(timeout_secs)` | owner | before trigger | Changes the check-in period |
| `set_estate_key(public_key)` | owner | before trigger | Records the key registered on Intents |
| `send_now(token_id, amount, salt)` | owner | panic button on | Executes the plan now |
| `sweep(token_id, amount, salt)` | anyone | after trigger | Executes the plan |
| `status()`, `preview_sweep(amount)`, `swept(token_id)` | anyone (views) | any time | State, payout preview, totals |

`salt` is the current salt of NEAR Intents (`current_salt` on `intents.near`). Attach 300 Tgas to `sweep` and `send_now`.

---

## Proof: tests on NEAR mainnet

All against the real MPC network (`v1.signer`) and the real NEAR Intents (`intents.near`), contract `deadswitch.thalderg.near`, owner `thalderg.near`.

**1. The key mechanism.** An intent signed through the contract, with a key nobody holds, moved 0.1 wNEAR out of the owner's own Intents account ([transaction](https://www.nearblocks.io/txns/7tQshpxGasARiJDf3L1eegPXnn9tLED35pi41jtCYfyw)):
```
EVENT_JSON:{"standard":"nep245","event":"mt_transfer","data":[{"old_owner_id":"thalderg.near",
  "new_owner_id":"deadswitch.thalderg.near","token_ids":["nep141:wrap.near"],"amounts":["100000000000000000000000"]}]}
```

**2. Sweep after the deadline (v2).** The heir `anna.thalderg.near` triggered the sweep; 0.1 wNEAR was paid from the owner's account per the testament, 0.07 to Anna and 0.03 to Marco. [add transaction link]

**3. Owner lockout.** After the timer ran out, the owner's `set_testament` and `set_estate_key` were refused, and `status` showed:
```
triggered: true
```

**4. Change delay (v3).** A new testament (70/30) first appeared as pending, then took effect after 60 seconds:
```
pending_testament: { heirs: [ anna 7000, marco 3000 ], effective_ns: '1794580230369834068' }
...after 60 s:
preview_sweep 0.1 wNEAR -> anna 70000000000000000000000, marco 30000000000000000000000
```

**5. Panic button (v3).** The owner executed the plan immediately with `send_now`. [add transaction link]

**6. Modes (v4).** Turning the panic button off applied at once (`send_now` then refused with `The panic button is off for this switch`); turning it back on waited for the change delay.

**7. Check-in operator (v5).** `checkin.thalderg.near` reset the timer, paying its own gas ([transaction](https://www.nearblocks.io/txns/6GJrL2zhDeaASViW7tCfE2aeYP25smYwAN59xNVQydew)):
```
last_ping_ns: '1794651995288825645'
deadline_ns: '1794738395288825645'
checkin_operator: 'checkin.thalderg.near'
last_operator_checkin_ns: '1794651995288825645'
```
A second check-in right after was refused:
```
Smart contract panicked: Too soon: the operator can check in at most once per interval
```

**Earlier, on testnet (v1):** the MPC network signed for the contract ([8B7SJxyp…](https://testnet.nearblocks.io/txns/8B7SJxypdFyoFfZmZhLotzgUXv1Ug1R6PGUjuTYUCTnQ)), an heir signed after the deadline ([GJhRaWzs…](https://testnet.nearblocks.io/txns/GJhRaWzs346zxcNwrkb2gJa4iWBkqubTijW6s1qJJVCa)), and the expected refusals and an Ed25519 signature followed.

**Unit tests:** 50, covering the timer, owner lockout, testament and change delay, modes, panic button, sweep rules, the check-in operator, and the exact intent format (including a real mainnet signature as a test vector).

---

## How it evolved

Each version is archived in `history/` and tagged in Git (`v1` to `v5`).

| Version | What it did | Why it changed |
| --- | --- | --- |
| v1 | Vault in the contract; per-heir ETH and SOL addresses through Chain Signatures | Nobody wants to move savings into a contract while alive |
| v2 | Funds stay in the owner's Intents account; the contract signs one intent paying heirs directly | The core design |
| v3 | Panic button, change delay | Emergencies and protection against coercion |
| v4 | Switch modes on and off | Owners change their minds |
| v5 | Check-in operator | Check-ins from email and Telegram, with no wallet and no fees |

---

## Run it yourself

Requirements: Rust, [`cargo-near`](https://github.com/near/cargo-near), [NEAR CLI](https://github.com/near/near-cli), a NEAR mainnet account with a small amount of wNEAR in NEAR Intents (Intents has no testnet).

```bash
cargo test
cargo near build non-reproducible-wasm

near deploy <contract>.near target/near/deadswitch.wasm --initFunction new \
  --initArgs '{"owner":"<owner>.near","timeout_secs":86400,"heirs":["<heir1>.near","<heir2>.near"],"mpc_contract":"v1.signer","intents_contract":"intents.near","timer_enabled":true,"panic_enabled":true,"change_delay_secs":60,"operator_min_interval_secs":60}' \
  --networkId mainnet

# The estate key: register it on your Intents account, then record it in the contract
KEY=$(near view v1.signer derived_public_key '{"path":"estate:intents","predecessor":"<contract>.near","domain_id":1}' --networkId mainnet | tail -1 | tr -d "'\"")
near call intents.near add_public_key "{\"public_key\":\"$KEY\"}" --depositYocto 1 --useAccount <owner>.near --networkId mainnet
near call <contract>.near set_estate_key "{\"public_key\":\"$KEY\"}" --useAccount <owner>.near --networkId mainnet

# After the deadline, anyone can carry out the plan
SALT=$(near view intents.near current_salt '{}' --networkId mainnet | tail -1 | tr -d "'\"")
near call <contract>.near sweep "{\"token_id\":\"nep141:wrap.near\",\"amount\":\"100000000000000000000000\",\"salt\":\"$SALT\"}" \
  --useAccount <anyone>.near --gas 300000000000000 --networkId mainnet
```

`scripts/intents-key-test.mjs` reproduces the key-mechanism test by hand.

---

## Status

- [x] Contract v5: timer, owner lockout, testament with change delay, modes, panic button, check-in operator, sweep through an MPC-signed intent
- [x] 50 unit tests
- [x] Tested on NEAR mainnet with the real MPC network and NEAR Intents
- [ ] Web app: setup, plan, Check in button, panic button, heir view
- [ ] Reminder service: email and Telegram, one-tap check-ins, automatic sweep, optional messages to heirs
- [ ] Demo with a real non-NEAR asset (SOL or ETH) held in Intents

## Known limitations

- Someone holding your NEAR key can still move funds out of your Intents account directly, around the contract. The panic button helps you win that race; the change delay protects your plan, not the account itself.
- The reminder service is part of what keeps the plan from running early for someone who never transacts. That's why reminders escalate near the deadline and use several channels.
- The caller of `sweep` chooses the amount per token (read from the owner's balance); a partial amount can be swept again.
- One contract per owner in this prototype.
