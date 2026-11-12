# Deadswitch: crypto inheritance on NEAR Intents

*Built at NEAR HACKATHON. @NEARProtocol #NEARHackathon*

When a crypto holder dies, their coins are often lost forever. Today there are only two fixes: share your seed phrase with family (risky while you're alive) or trust a custodian (a company that can fail, freeze or misuse funds).

**Deadswitch needs neither, and your funds never leave your account.**

- You keep your crypto in **your own NEAR Intents account**, fully available: trade, swap and withdraw whenever you want.
- You give the switch **one permission**: an extra key on your Intents account that **nobody holds**. Only NEAR's MPC network can sign with it, and only when the Deadswitch contract asks.
- You check in regularly. While you do, the contract **refuses** to use that key.
- If you stop checking in, the switch triggers: the contract uses the key once to pass your funds to your heirs.

You can remove the permission at any time while you're alive.

> This is a hackathon prototype, not a legal will.

---

## What it covers

Everything you hold in your NEAR Intents account. NEAR Intents holds **real** assets from many chains, so this includes:

- **NEAR** (held in Intents as wNEAR, 1:1)
- **BTC, ETH, SOL**, deposited from their native chains
- **USDC** and other tokens NEAR Intents supports, including yield-bearing tokens such as liquid staking tokens, if Intents lists them

Heirs receive the assets in their own Intents account and can **withdraw them to their own Bitcoin, Ethereum or Solana wallet** through NEAR Intents.

**Not covered yet:** funds in ordinary wallets outside Intents (MetaMask, Phantom, a Bitcoin wallet), plain NEAR in a NEAR wallet, and positions locked inside DeFi protocols. See the roadmap.

---

## How it works

1. **Protect.** The owner registers the switch's key on their own Intents account (`add_public_key` on `intents.near`). The key is derived by NEAR Chain Signatures from the Deadswitch contract's account plus a fixed path, so its private half never exists anywhere.
2. **Check in.** Every owner action (`ping`, changing heirs, signing) resets a timer.
3. **Trigger.** When the timer runs out, the switch is **final**: the owner is locked out, which protects the heirs if the owner's key is stolen after death.
4. **Sweep.** Anyone can trigger the sweep. The contract writes **one fixed intent**, "transfer these tokens from the owner's Intents account to the switch", has the MPC network sign it, and submits it to `intents.near`. The contract writes the destination itself, so nobody, heirs included, can redirect the funds.
5. **Split.** Each heir claims their share (`claim_intents`), or anyone triggers the payout for them.

### Why nobody can cheat

- **No one holds the key.** NEAR's MPC network splits the signing key into shares across independent operators; a threshold of them must cooperate, and the full key never exists in one place.
- **Only the contract can use it.** Chain Signatures derive the key from the account that requests the signature. That account is the Deadswitch contract, and its code decides when the key may sign.
- **The key only works inside NEAR Intents.** It can't touch the owner's NEAR account or any other wallet.
- **Fair payouts.** The first claim for a token takes a snapshot of the balance, so every heir's share is computed from the same total, whoever claims first. Each claim is locked before the transfer and confirmed in a callback; if the transfer fails, it is undone so the heir can retry.

---

## The testament

**Today:** balances are split **equally** between the heirs. The contract already stores each heir's share in basis points (10,000 = 100%).

**Next: a full testament.** The owner writes rules such as *"50% to Anna in BTC, 30% to Marco in USDC, 20% to a charity"*:
- stored as structured rules that the contract executes automatically,
- optionally converting assets at payout time, since NEAR Intents can swap,
- optionally delivering each share **straight to an heir's own wallet** (for example Anna's Bitcoin address), using NEAR Intents withdrawals, so heirs don't even need a NEAR account,
- optionally drafted from the owner's own words by a NEAR AI private model, then confirmed by the owner. The AI never interprets the will at payout time.

**Then: a private testament.** A testament stored on-chain is public while the owner is alive. To keep it secret until the switch triggers:
- only a hash of the testament goes on-chain,
- the full testament is encrypted with a key from NEAR's **Confidential Key Derivation**, which only becomes available once the deadline has passed. Until then, not even the MPC nodes can read it,
- once opened, it runs inside a secure enclave (TEE) that publishes a signed proof that what it executed matches the hash.

Result: inheritance that is **verifiable, but secret until death**.

---

## Roadmap

- **Funds in any wallet, outside Intents.** Each chain has its own mechanism for "someone else may move my funds after a deadline", which Deadswitch's MPC-controlled keys can plug into:
  - **Ethereum and EVM chains:** EIP-7702 lets an ordinary address run rules such as "after the deadline, the switch may move my ETH". ERC-20 tokens can also use allowances.
  - **Bitcoin:** built-in timelocked recovery paths ("after N months, this other key can spend").
  - **Solana:** no built-in mechanism for native SOL; this needs a small Solana program.
- **Plain NEAR and DeFi positions on NEAR:** a switch-controlled key on the NEAR account itself, plus per-protocol logic to unstake or withdraw.
- **Delivery straight to heirs' wallets** through NEAR Intents withdrawals.
- **The testament** and **private testament** described above.
- **Automatic execution:** a keeper (for example a NEAR Shade Agent) that triggers the sweep and payouts as soon as the deadline passes.
- **Grace period and notifications** before the switch becomes final, to protect against a forgotten check-in.
- **Locked deployment:** deleting the contract's full-access keys, so nobody can ever change the code.

---

## Contract API (current code)

| Function | Who | When | What it does |
| --- | --- | --- | --- |
| `new(owner, timeout_secs, heirs, mpc_contract, intents_contract)` | contract account | once, at deploy | Initialises the switch |
| `ping()` | owner | before the deadline | "I'm alive": resets the timer |
| `set_heirs(heirs)` | owner | before the deadline | Replaces the heirs (equal split) |
| `set_timeout(timeout_secs)` | owner | before the deadline | Changes the timeout |
| `request_signature(path, payload, domain_id)` | owner: any path / heir: own paths | owner before, heirs after the deadline | Asks the MPC network to sign. `domain_id` 0 = ECDSA, 1 = EdDSA (the key type of NEAR and Intents keys). Returns the signature |
| `claim_intents(token_id)` | heir | after the deadline | Pays the heir's share of an Intents token held by the switch |
| `owner_withdraw_intents(token_id, amount)` | owner | before the deadline | Owner takes Intents funds held by the switch back |
| `deposit_near()` / `owner_withdraw_near(amount)` | owner | before the deadline | Native NEAR held by the switch itself |
| `claim_near()` | heir | after the deadline | Sends the heir's NEAR share to their wallet |
| `distribute_near()` | anyone | after the deadline | Sends the NEAR share of every heir who hasn't claimed yet |
| `status()` | anyone (view) | any time | Owner, heirs, deadline, whether triggered |
| `claim_info(token_id)` / `near_info()` | anyone (view) | any time | Snapshot, amount paid and who has claimed |

---

## Run it yourself

Requirements: Rust, [`cargo-near`](https://github.com/near/cargo-near), [NEAR CLI](https://github.com/near/near-cli), a NEAR testnet account.

```bash
# Unit tests: timer, owner lockout, signing rules, payouts, double-claim protection
cargo test

# Build
cargo near build non-reproducible-wasm

# Deploy and initialise on testnet (5-minute timeout, two heirs)
near deploy <contract>.testnet target/near/deadswitch.wasm --initFunction new \
  --initArgs '{"owner":"<owner>.testnet","timeout_secs":300,"heirs":["<heir1>.testnet","<heir2>.testnet"],"mpc_contract":"v1.signer-prod.testnet","intents_contract":"intents.near"}' \
  --networkId testnet

# Status
near view <contract>.testnet status '{}' --networkId testnet
```

NEAR Intents has no testnet, so everything involving Intents runs on mainnet (`mpc_contract: v1.signer`, `intents_contract: intents.near`). `scripts/intents-key-test.mjs` builds and formats an intent signed through the contract, for testing the key mechanism.

---

## Proof so far

Signing rules, tested on testnet (`deadswitch.thalderg.testnet`) against the real MPC network `v1.signer-prod.testnet`:

| Test | Result | Transaction |
| --- | --- | --- |
| Owner requests a signature before the deadline | Signature returned; the MPC network sees **the contract** as the requester | [8B7SJxyp…](https://testnet.nearblocks.io/txns/8B7SJxypdFyoFfZmZhLotzgUXv1Ug1R6PGUjuTYUCTnQ) |
| Heir requests a signature before the deadline | Refused: `Deadline not reached` | |
| Heir requests a signature for her own path after the deadline | Signature returned | [GJhRaWzs…](https://testnet.nearblocks.io/txns/GJhRaWzs346zxcNwrkb2gJa4iWBkqubTijW6s1qJJVCa) |
| Heir requests a signature for another heir's path | Refused: `Heirs can only sign for their own paths` | |
| Owner tries to check in after the deadline | Refused: `owner actions are disabled` | |
| EdDSA (Ed25519) signature requested through the contract | Ed25519 signature returned | |

---

## Status

- [x] Contract: timer, owner lockout, signing gate, payout split with snapshot and callbacks
- [x] 23 unit tests
- [x] Signing rules tested on testnet against the real MPC network
- [ ] Key mechanism tested on mainnet: an intent signed through the contract moves funds out of the owner's own Intents account
- [ ] `sweep`: the contract builds and submits the fixed intent itself after the deadline
- [ ] Web app: protect, check in, countdown, sweep, claim
- [ ] Demo with real non-NEAR assets (SOL or ETH) held in Intents

## Known limitations

- Tokens arriving after the first claim's snapshot are not split.
- A forgotten check-in triggers the switch; the grace period on the roadmap addresses this.
