//! Deadswitch: a cross-chain dead man's switch on NEAR.
//!
//! - The owner checks in with `ping()` (any owner action also counts).
//! - While the owner is alive, only the owner can request MPC signatures.
//! - Once the deadline passes, the switch is final: each heir can request
//!   signatures only for their own paths (`heir:<account>:<label>`) and claim
//!   their share of the contract's NEAR Intents balances.
//!
//! The contract holds no private keys. It only decides *when* the MPC network
//! may sign and *when* Intents balances may move.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::{
    AccountId, Gas, GasWeight, NearToken, PanicOnDefault, Promise, PromiseOrValue, env, near,
    require,
};
use std::collections::BTreeMap;

const NS_PER_SEC: u64 = 1_000_000_000;
const BPS_TOTAL: u32 = 10_000;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

/// Minimum gas forwarded to the MPC `sign` call. Any unused gas of the
/// transaction is added on top (GasWeight), so callers should attach 300 Tgas.
const GAS_SIGN: Gas = Gas::from_tgas(50);
const GAS_MT_BALANCE: Gas = Gas::from_tgas(10);
const GAS_MT_TRANSFER: Gas = Gas::from_tgas(30);
const GAS_CALLBACK: Gas = Gas::from_tgas(40);

/// ECDSA payloads are a 32-byte hash (64 hex chars). EdDSA payloads are the
/// full message bytes; a Solana transaction is at most 1232 bytes.
const ECDSA_PAYLOAD_HEX_LEN: usize = 64;
const EDDSA_PAYLOAD_MAX_BYTES: usize = 1232;
/// Largest callback result we read (a balance is a short JSON string).
const MAX_RESULT_BYTES: usize = 1024;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Heir {
    pub account_id: AccountId,
    /// Share of each Intents token, in basis points (10,000 = 100%).
    pub share_bps: u32,
}

#[near(serializers = [json])]
pub struct Status {
    pub owner: AccountId,
    pub heirs: Vec<Heir>,
    pub timeout_secs: u64,
    pub last_ping_ns: U128,
    pub deadline_ns: U128,
    pub now_ns: U128,
    pub triggered: bool,
}

#[near(serializers = [json])]
pub struct ClaimInfo {
    pub snapshot: Option<U128>,
    pub paid: U128,
    pub claimed_by: Vec<AccountId>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    heirs: Vec<Heir>,
    timeout_ns: u64,
    last_ping_ns: u64,
    mpc_contract: AccountId,
    intents_contract: AccountId,
    /// token_id -> contract balance taken at the first claim after the deadline.
    snapshots: BTreeMap<String, u128>,
    /// token_id -> total amount paid out (or in flight) to heirs.
    paid: BTreeMap<String, u128>,
    /// token_id -> heirs who claimed (or whose claim is in flight).
    claimed: BTreeMap<String, Vec<AccountId>>,
}

#[near]
impl Contract {
    // ------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------

    /// One-time initialisation, called by the contract account itself at deploy.
    #[init]
    #[private]
    pub fn new(
        owner: AccountId,
        timeout_secs: u64,
        heirs: Vec<AccountId>,
        mpc_contract: AccountId,
        intents_contract: AccountId,
    ) -> Self {
        require!(timeout_secs > 0, "timeout_secs must be greater than 0");
        Self {
            owner,
            heirs: equal_shares(heirs),
            timeout_ns: timeout_secs * NS_PER_SEC,
            last_ping_ns: env::block_timestamp(),
            mpc_contract,
            intents_contract,
            snapshots: BTreeMap::new(),
            paid: BTreeMap::new(),
            claimed: BTreeMap::new(),
        }
    }

    // ------------------------------------------------------------------
    // Owner actions (each one also counts as a check-in)
    // ------------------------------------------------------------------

    /// "I'm alive": resets the timer.
    pub fn ping(&mut self) {
        self.owner_check_in();
    }

    /// Replace the list of heirs. v1 splits Intents balances equally.
    pub fn set_heirs(&mut self, heirs: Vec<AccountId>) {
        self.owner_check_in();
        self.heirs = equal_shares(heirs);
    }

    /// Change how long the owner can stay silent before the switch triggers.
    pub fn set_timeout(&mut self, timeout_secs: u64) {
        self.owner_check_in();
        require!(timeout_secs > 0, "timeout_secs must be greater than 0");
        self.timeout_ns = timeout_secs * NS_PER_SEC;
    }

    /// Owner takes Intents funds back while still alive.
    pub fn owner_withdraw_intents(&mut self, token_id: String, amount: U128) -> Promise {
        self.owner_check_in();
        self.mt_transfer(self.owner.clone(), &token_id, amount.0)
    }

    // ------------------------------------------------------------------
    // Signing gate (controls the ETH / SOL addresses)
    // ------------------------------------------------------------------

    /// Ask the MPC network to sign `payload` (hex) with the key derived from
    /// this contract's account and `path`.
    /// `domain_id`: 0 = ECDSA (Ethereum, Bitcoin), 1 = EdDSA (Solana).
    /// The transaction result is the MPC signature.
    pub fn request_signature(&mut self, path: String, payload: String, domain_id: u32) -> Promise {
        let caller = env::predecessor_account_id();

        if caller == self.owner {
            // Owner may sign for any path, but only while alive.
            self.owner_check_in();
        } else {
            require!(self.is_triggered(), "Deadline not reached");
            require!(
                self.is_heir(&caller),
                "Only the owner or an heir can request signatures"
            );
            require!(
                path.starts_with(&heir_path_prefix(&caller)),
                "Heirs can only sign for their own paths"
            );
        }

        let payload_key = match domain_id {
            0 => {
                require!(
                    payload.len() == ECDSA_PAYLOAD_HEX_LEN && is_hex(&payload),
                    "ECDSA payload must be a 32-byte hash as 64 hex characters"
                );
                "Ecdsa"
            }
            1 => {
                require!(
                    !payload.is_empty()
                        && payload.len() % 2 == 0
                        && payload.len() <= EDDSA_PAYLOAD_MAX_BYTES * 2
                        && is_hex(&payload),
                    "EdDSA payload must be the message bytes as hex"
                );
                "Eddsa"
            }
            _ => env::panic_str("domain_id must be 0 (ECDSA) or 1 (EdDSA)"),
        };

        let args = json!({
            "request": {
                "path": path,
                "payload_v2": { payload_key: payload.to_lowercase() },
                "domain_id": domain_id,
            }
        });

        Promise::new(self.mpc_contract.clone()).function_call_weight(
            "sign".to_string(),
            serde_json::to_vec(&args).unwrap(),
            ONE_YOCTO,
            GAS_SIGN,
            GasWeight(1),
        )
    }

    // ------------------------------------------------------------------
    // Intents payouts
    // ------------------------------------------------------------------

    /// After the deadline, an heir claims their share of one Intents token.
    /// The first claim per token snapshots the balance, so every share is
    /// computed from the same total. The last heir to claim also receives
    /// any rounding remainder.
    pub fn claim_intents(&mut self, token_id: String) -> PromiseOrValue<U128> {
        require!(self.is_triggered(), "Deadline not reached");
        let heir = env::predecessor_account_id();
        require!(self.is_heir(&heir), "Only heirs can claim");

        // Lock this claim first, so it can't run twice in parallel.
        let list = self.claimed.entry(token_id.clone()).or_default();
        require!(!list.contains(&heir), "Already claimed this token");
        list.push(heir.clone());

        if self.snapshots.contains_key(&token_id) {
            return self.pay_share(token_id, heir);
        }

        // No snapshot yet: read the contract's balance, then continue in on_balance.
        PromiseOrValue::Promise(
            Promise::new(self.intents_contract.clone())
                .function_call(
                    "mt_balance_of".to_string(),
                    serde_json::to_vec(&json!({
                        "account_id": env::current_account_id(),
                        "token_id": token_id,
                    }))
                    .unwrap(),
                    NearToken::from_yoctonear(0),
                    GAS_MT_BALANCE,
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_CALLBACK.saturating_add(GAS_MT_TRANSFER))
                        .on_balance(token_id, heir),
                ),
        )
    }

    #[private]
    pub fn on_balance(&mut self, token_id: String, heir: AccountId) -> PromiseOrValue<U128> {
        let balance: Option<U128> = env::promise_result_checked(0, MAX_RESULT_BYTES)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());
        match balance {
            Some(balance) => {
                // Keep the first snapshot if a parallel claim already stored one.
                self.snapshots.entry(token_id.clone()).or_insert(balance.0);
                self.pay_share(token_id, heir)
            }
            None => {
                // Don't panic: undo the lock so the heir can try again.
                self.unlock_claim(&token_id, &heir);
                env::log_str("Could not read the Intents balance; claim cancelled");
                PromiseOrValue::Value(U128(0))
            }
        }
    }

    #[private]
    pub fn on_transfer(&mut self, token_id: String, heir: AccountId, amount: U128) -> U128 {
        match env::promise_result_checked(0, MAX_RESULT_BYTES) {
            Ok(_) => amount,
            Err(_) => {
                // Transfer failed: undo the bookkeeping so the heir can retry.
                if let Some(p) = self.paid.get_mut(&token_id) {
                    *p = p.saturating_sub(amount.0);
                }
                self.unlock_claim(&token_id, &heir);
                env::log_str("Intents transfer failed; claim cancelled");
                U128(0)
            }
        }
    }

    // ------------------------------------------------------------------
    // Views (free, read-only)
    // ------------------------------------------------------------------

    pub fn status(&self) -> Status {
        Status {
            owner: self.owner.clone(),
            heirs: self.heirs.clone(),
            timeout_secs: self.timeout_ns / NS_PER_SEC,
            last_ping_ns: U128(self.last_ping_ns as u128),
            deadline_ns: U128(self.deadline_ns() as u128),
            now_ns: U128(env::block_timestamp() as u128),
            triggered: self.is_triggered(),
        }
    }

    /// The derivation path an heir uses for a given label, e.g. "eth" or "sol".
    pub fn heir_path(&self, heir: AccountId, label: String) -> String {
        format!("{}{}", heir_path_prefix(&heir), label)
    }

    pub fn claim_info(&self, token_id: String) -> ClaimInfo {
        ClaimInfo {
            snapshot: self.snapshots.get(&token_id).map(|v| U128(*v)),
            paid: U128(*self.paid.get(&token_id).unwrap_or(&0)),
            claimed_by: self.claimed.get(&token_id).cloned().unwrap_or_default(),
        }
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    fn deadline_ns(&self) -> u64 {
        self.last_ping_ns.saturating_add(self.timeout_ns)
    }

    fn is_triggered(&self) -> bool {
        env::block_timestamp() >= self.deadline_ns()
    }

    fn is_heir(&self, account: &AccountId) -> bool {
        self.heirs.iter().any(|h| &h.account_id == account)
    }

    /// Checks the caller is the owner and the switch hasn't triggered, then
    /// resets the timer. Once triggered, the switch is final: this protects
    /// heirs if the owner's key is stolen after death.
    fn owner_check_in(&mut self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only the owner can do this"
        );
        require!(
            !self.is_triggered(),
            "Switch already triggered; owner actions are disabled"
        );
        self.last_ping_ns = env::block_timestamp();
    }

    fn pay_share(&mut self, token_id: String, heir: AccountId) -> PromiseOrValue<U128> {
        let snapshot = *self.snapshots.get(&token_id).expect("snapshot must exist");
        let already_paid = *self.paid.get(&token_id).unwrap_or(&0);
        let claims = self.claimed.get(&token_id).map(|l| l.len()).unwrap_or(0);

        let amount = if claims >= self.heirs.len() {
            // Last heir: everything left, including rounding dust.
            snapshot.saturating_sub(already_paid)
        } else {
            let bps = self
                .heirs
                .iter()
                .find(|h| h.account_id == heir)
                .map(|h| h.share_bps)
                .unwrap_or(0) as u128;
            snapshot / BPS_TOTAL as u128 * bps
                + (snapshot % BPS_TOTAL as u128) * bps / BPS_TOTAL as u128
        };

        if amount == 0 {
            return PromiseOrValue::Value(U128(0));
        }

        self.paid.insert(token_id.clone(), already_paid + amount);

        PromiseOrValue::Promise(
            self.mt_transfer(heir.clone(), &token_id, amount).then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_transfer(token_id, heir, U128(amount)),
            ),
        )
    }

    fn mt_transfer(&self, receiver_id: AccountId, token_id: &str, amount: u128) -> Promise {
        Promise::new(self.intents_contract.clone()).function_call(
            "mt_transfer".to_string(),
            serde_json::to_vec(&json!({
                "receiver_id": receiver_id,
                "token_id": token_id,
                "amount": U128(amount),
            }))
            .unwrap(),
            ONE_YOCTO,
            GAS_MT_TRANSFER,
        )
    }

    fn unlock_claim(&mut self, token_id: &str, heir: &AccountId) {
        if let Some(list) = self.claimed.get_mut(token_id) {
            list.retain(|a| a != heir);
        }
    }
}

fn heir_path_prefix(heir: &AccountId) -> String {
    format!("heir:{}:", heir)
}

fn is_hex(s: &str) -> bool {
    s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Equal split in basis points; the last heir gets the rounding remainder.
fn equal_shares(accounts: Vec<AccountId>) -> Vec<Heir> {
    require!(!accounts.is_empty(), "At least one heir is required");
    let mut unique = accounts.clone();
    unique.sort();
    unique.dedup();
    require!(unique.len() == accounts.len(), "Duplicate heirs");

    let n = accounts.len() as u32;
    let base = BPS_TOTAL / n;
    let last = BPS_TOTAL - base * (n - 1);
    accounts
        .into_iter()
        .enumerate()
        .map(|(i, account_id)| Heir {
            account_id,
            share_bps: if i as u32 == n - 1 { last } else { base },
        })
        .collect()
}

// ----------------------------------------------------------------------
// Unit tests: `cargo test`
// ----------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const SEC: u64 = NS_PER_SEC;
    const T0: u64 = 1_000 * SEC;
    const TIMEOUT: u64 = 120; // 2 minutes, like the demo

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ctx(caller: &str, now: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("deadswitch.thalderg.testnet"))
            .predecessor_account_id(acc(caller))
            .block_timestamp(now);
        testing_env!(b.build());
    }

    fn setup() -> Contract {
        ctx("deadswitch.thalderg.testnet", T0);
        Contract::new(
            acc("thalderg.testnet"),
            TIMEOUT,
            vec![
                acc("anna.testnet"),
                acc("marco.testnet"),
                acc("luca.testnet"),
            ],
            acc("v1.signer-prod.testnet"),
            acc("intents.near"),
        )
    }

    const HASH: &str = "0101010101010101010101010101010101010101010101010101010101010101";

    #[test]
    fn equal_split_adds_up_to_100_percent() {
        let c = setup();
        let shares: Vec<u32> = c.status().heirs.iter().map(|h| h.share_bps).collect();
        assert_eq!(shares, vec![3333, 3333, 3334]);
    }

    #[test]
    fn not_triggered_before_deadline_and_triggered_after() {
        let c = setup();
        ctx("anyone.testnet", T0 + (TIMEOUT - 1) * SEC);
        assert!(!c.status().triggered);
        ctx("anyone.testnet", T0 + TIMEOUT * SEC);
        assert!(c.status().triggered);
    }

    #[test]
    fn ping_resets_the_timer() {
        let mut c = setup();
        ctx("thalderg.testnet", T0 + 100 * SEC);
        c.ping();
        ctx("anyone.testnet", T0 + 150 * SEC); // 50 s after the ping
        assert!(!c.status().triggered);
    }

    #[test]
    #[should_panic(expected = "Only the owner can do this")]
    fn stranger_cannot_ping() {
        let mut c = setup();
        ctx("stranger.testnet", T0 + SEC);
        c.ping();
    }

    #[test]
    #[should_panic(expected = "owner actions are disabled")]
    fn owner_cannot_ping_after_trigger() {
        let mut c = setup();
        ctx("thalderg.testnet", T0 + TIMEOUT * SEC);
        c.ping();
    }

    #[test]
    fn owner_can_sign_any_path_before_deadline() {
        let mut c = setup();
        ctx("thalderg.testnet", T0 + SEC);
        let _ = c.request_signature("heir:anna.testnet:eth".into(), HASH.into(), 0);
        assert_eq!(c.last_ping_ns, T0 + SEC); // signing counted as a check-in
    }

    #[test]
    #[should_panic(expected = "Deadline not reached")]
    fn heir_refused_before_deadline() {
        let mut c = setup();
        ctx("anna.testnet", T0 + SEC);
        let _ = c.request_signature("heir:anna.testnet:eth".into(), HASH.into(), 0);
    }

    #[test]
    fn heir_allowed_after_deadline_for_own_path() {
        let mut c = setup();
        ctx("anna.testnet", T0 + TIMEOUT * SEC);
        let _ = c.request_signature("heir:anna.testnet:eth".into(), HASH.into(), 0);
        let _ = c.request_signature("heir:anna.testnet:sol".into(), "abcd".into(), 1);
    }

    #[test]
    #[should_panic(expected = "Heirs can only sign for their own paths")]
    fn heir_refused_for_another_heirs_path() {
        let mut c = setup();
        ctx("anna.testnet", T0 + TIMEOUT * SEC);
        let _ = c.request_signature("heir:marco.testnet:eth".into(), HASH.into(), 0);
    }

    #[test]
    #[should_panic(expected = "Only the owner or an heir")]
    fn stranger_refused_after_deadline() {
        let mut c = setup();
        ctx("stranger.testnet", T0 + TIMEOUT * SEC);
        let _ = c.request_signature("heir:stranger.testnet:eth".into(), HASH.into(), 0);
    }

    #[test]
    #[should_panic(expected = "64 hex characters")]
    fn bad_ecdsa_payload_refused() {
        let mut c = setup();
        ctx("thalderg.testnet", T0 + SEC);
        let _ = c.request_signature("owner:eth".into(), "1234".into(), 0);
    }

    #[test]
    fn heir_path_view() {
        let c = setup();
        assert_eq!(
            c.heir_path(acc("anna.testnet"), "eth".into()),
            "heir:anna.testnet:eth"
        );
    }

    #[test]
    #[should_panic(expected = "Deadline not reached")]
    fn claim_refused_before_deadline() {
        let mut c = setup();
        ctx("anna.testnet", T0 + SEC);
        let _ = c.claim_intents("nep141:wrap.near".into());
    }

    #[test]
    #[should_panic(expected = "Already claimed")]
    fn double_claim_refused() {
        let mut c = setup();
        ctx("anna.testnet", T0 + TIMEOUT * SEC);
        let _ = c.claim_intents("nep141:wrap.near".into());
        let _ = c.claim_intents("nep141:wrap.near".into());
    }

    #[test]
    fn shares_from_snapshot_and_last_heir_gets_remainder() {
        let mut c = setup();
        ctx("anna.testnet", T0 + TIMEOUT * SEC);
        let token = "nep141:wrap.near".to_string();
        c.snapshots.insert(token.clone(), 1_000_001);

        c.claimed.insert(token.clone(), vec![acc("anna.testnet")]);
        let _ = c.pay_share(token.clone(), acc("anna.testnet"));
        assert_eq!(c.paid[&token], 333_300); // 33.33%

        c.claimed
            .get_mut(&token)
            .unwrap()
            .push(acc("marco.testnet"));
        let _ = c.pay_share(token.clone(), acc("marco.testnet"));
        assert_eq!(c.paid[&token], 666_600);

        c.claimed.get_mut(&token).unwrap().push(acc("luca.testnet"));
        let _ = c.pay_share(token.clone(), acc("luca.testnet"));
        assert_eq!(c.paid[&token], 1_000_001); // last heir takes the rest
    }

    #[test]
    #[should_panic(expected = "Duplicate heirs")]
    fn duplicate_heirs_refused() {
        equal_shares(vec![acc("anna.testnet"), acc("anna.testnet")]);
    }
}
