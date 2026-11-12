# Deadswitch: cross-chain crypto inheritance on NEAR

*Built at NEAR HACKATHON.*

When a crypto holder dies, their coins are often lost forever. Today the only fixes are sharing a seed phrase with family (risky) or trusting a custodian (a company).

**Deadswitch** is a dead man's switch that needs neither. The owner checks in regularly. If they stop, a NEAR smart contract hands control to their heirs, across chains:

- **ETH and SOL:** each heir gets their own real Ethereum and Solana address, controlled by the contract through NEAR Chain Signatures.
- **Any coin supported by NEAR Intents:** balances held by the contract are split between the heirs.

Nobody holds a key that can get around the rules: not the heirs, not a custodian, not the developer.

> This is a hackathon prototype, not a legal will.

---

## How it works

The contract holds **no private keys**. It is a rulebook and a gatekeeper:

1. **Check-ins.** Every owner action (`ping`, changing heirs, signing, withdrawing) resets a timer.
2. **While the owner is alive,** only the owner can request signatures, for any address, and move funds.
3. **When the timer runs out, the switch is final.** The owner is locked out (this protects heirs if the owner's key is stolen after death), and each heir can:
   - request signatures **only for their own addresses** (derivation paths `heir:<account>:<label>`, e.g. `heir:anna.near:eth`),
   - claim their share of the contract's NEAR Intents balances.

### Why the heirs' addresses are safe

NEAR Chain Signatures derive an address on another chain from **the NEAR account that asks for a signature** plus a **path**. Because the *contract* asks, the addresses belong to the contract, and the contract's code decides who may use each path and when.

The signatures themselves come from NEAR's MPC network: the signing key is split into shares across independent node operators, a threshold of them must cooperate to sign, and the full key never exists in one place. Ethereum and Solana see ordinary addresses and ordinary signatures.

### Intents payouts

- The first claim for a token takes a **snapshot** of the contract's balance, so every heir's share is computed from the same total, no matter who claims first.
- Each claim is **locked** before the transfer and **confirmed in a callback**; if the transfer fails, the bookkeeping is undone so the heir can retry.
- v1 splits balances **equally** (in basis points); the last heir to claim also receives any rounding remainder.

---

## Contract API

| Function | Who | When | What it does |
| --- | --- | --- | --- |
| `new(owner, timeout_secs, heirs, mpc_contract, intents_contract)` | contract account | once, at deploy | Initialises the switch |
| `ping()` | owner | before the deadline | "I'm alive": resets the timer |
| `set_heirs(heirs)` | owner | before the deadline | Replaces the heirs (equal split) |
| `set_timeout(timeout_secs)` | owner | before the deadline | Changes the timeout |
| `request_signature(path, payload, domain_id)` | owner: any path / heir: own paths | owner before, heirs after the deadline | Asks the MPC network to sign. `domain_id` 0 = ECDSA (Ethereum), 1 = EdDSA (Solana). Returns the signature |
| `claim_intents(token_id)` | heir | after the deadline | Pays the heir's share of an Intents token |
| `owner_withdraw_intents(token_id, amount)` | owner | before the deadline | Owner takes Intents funds back |
| `status()` | anyone (view) | any time | Owner, heirs, deadline, whether triggered |
| `heir_path(heir, label)` | anyone (view) | any time | The derivation path an heir uses, e.g. for `eth` |
| `claim_info(token_id)` | anyone (view) | any time | Snapshot, amount paid and who has claimed |

---

## Run it yourself

Requirements: Rust, [`cargo-near`](https://github.com/near/cargo-near), [NEAR CLI](https://github.com/near/near-cli), a NEAR testnet account.

```bash
# Unit tests (timer, signing rules, equal split, double-claim protection)
cargo test

# Build the contract
cargo near build non-reproducible-wasm

# Deploy and initialise on testnet (5-minute timeout, two heirs)
near deploy <contract>.testnet target/near/deadswitch.wasm --initFunction new \
  --initArgs '{"owner":"<owner>.testnet","timeout_secs":300,"heirs":["<heir1>.testnet","<heir2>.testnet"],"mpc_contract":"v1.signer-prod.testnet","intents_contract":"intents.near"}' \
  --networkId testnet

# Status
near view <contract>.testnet status '{}' --networkId testnet

# Owner requests a signature (any path, before the deadline)
near call <contract>.testnet request_signature \
  '{"path":"owner:eth","payload":"<32-byte hash as 64 hex chars>","domain_id":0}' \
  --useAccount <owner>.testnet --gas 300000000000000 --networkId testnet

# After the deadline, an heir requests a signature for their own path
near call <contract>.testnet request_signature \
  '{"path":"heir:<heir1>.testnet:eth","payload":"<64 hex chars>","domain_id":0}' \
  --useAccount <heir1>.testnet --gas 300000000000000 --networkId testnet
```

NEAR Intents has no testnet, so Intents payouts run on mainnet (`mpc_contract: v1.signer`, `intents_contract: intents.near`).

---

## Proof on testnet

Contract: `deadswitch.thalderg.testnet`, using the real testnet MPC signer `v1.signer-prod.testnet`.

| Test | Result | Transaction |
| --- | --- | --- |
| Owner requests a signature before the deadline | ECDSA signature returned; the MPC contract sees the **contract** as the requester | [8B7SJxyp…](https://testnet.nearblocks.io/txns/8B7SJxypdFyoFfZmZhLotzgUXv1Ug1R6PGUjuTYUCTnQ) |
| Heir requests a signature before the deadline | Refused: `Deadline not reached` | |
| Heir requests a signature for her own path after the deadline | ECDSA signature returned | [GJhRaWzs…](https://testnet.nearblocks.io/txns/GJhRaWzs346zxcNwrkb2gJa4iWBkqubTijW6s1qJJVCa) |
| Heir requests a signature for another heir's path | Refused: `Heirs can only sign for their own paths` | |
| Owner tries to check in after the deadline | Refused: `owner actions are disabled` | |
| Heir requests a Solana-style (EdDSA) signature | Ed25519 signature returned | |

---

## Status

- [x] Contract: switch logic, signing gate, Intents payouts
- [x] 16 unit tests
- [x] Signing rules tested on testnet against the real MPC network
- [ ] Mainnet deployment and Intents payouts tested with real funds
- [ ] Web app: owner and heir pages, real ETH and SOL transfers

## Limitations and next steps

- **Testament:** custom shares per heir and per asset instead of an equal split.
- **Private testament:** keep the testament secret until the switch triggers, for example encrypted under a key from NEAR's Confidential Key Derivation that only becomes available once the deadline has passed.
- **Grace period:** warnings and a short cancellation window before the switch becomes final, to protect against a forgotten check-in.
- **Late deposits:** Intents tokens deposited after the first claim's snapshot are not split.
- **Native coins only** for ETH and SOL in v1 (an ERC-20 needs ETH for gas at the heir's address).
- **Locking:** a production deployment would delete the contract's full-access keys so that nobody can change the code.
