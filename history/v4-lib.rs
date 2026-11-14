//! Deadswitch v4: crypto inheritance and a panic button on NEAR Intents.
//!
//! The owner keeps their funds in their own NEAR Intents account and registers
//! one extra key on it: a key derived by NEAR Chain Signatures from this
//! contract's account and the path `estate:intents`. Nobody holds that key;
//! only the MPC network can sign with it, and only when this contract asks.
//!
//! - The owner checks in with `ping()` (any owner action also counts).
//! - While the owner is alive, the contract never uses the key.
//! - Once the deadline passes, the switch is final. Anyone can call `sweep`:
//!   the contract writes one transfer intent that pays each heir their share
//!   straight from the owner's Intents account, has the MPC network sign it,
//!   and submits it to NEAR Intents. Funds never pass through this contract.
//! - Panic button (optional): the owner can execute the same testament
//!   immediately with `send_now`, e.g. if they suspect their keys are compromised.
//! - Changes to the testament only take effect after a delay fixed at deploy,
//!   so nobody holding the owner's key can quickly redirect the funds.
//! - The owner can switch the timer and the panic button on or off later.
//!   Turning a feature off applies at once; turning one on waits for the
//!   same change delay.

use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{
    env, near, require, AccountId, Gas, GasWeight, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};
use std::collections::BTreeMap;

const NS_PER_SEC: u64 = 1_000_000_000;
const BPS_TOTAL: u32 = 10_000;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

/// Derivation path of the estate key registered on the owner's Intents account.
pub const ESTATE_PATH: &str = "estate:intents";
/// MPC domain for Ed25519 signatures (the key type of NEAR and Intents keys).
const EDDSA_DOMAIN: u32 = 1;
/// An Ed25519 payload must fit what the MPC network accepts.
const MAX_PAYLOAD_BYTES: usize = 1232;
/// How long a signed sweep intent stays valid.
const INTENT_VALIDITY_MS: u64 = 60 * 60 * 1000;
/// Versioned nonce V1 marker used by NEAR Intents.
const VERSIONED_NONCE_PREFIX: [u8; 4] = [0x56, 0x28, 0xf6, 0xc6];
const MAX_RESULT_BYTES: usize = 4096;

const GAS_SIGN: Gas = Gas::from_tgas(50);
const GAS_ON_SIGNED: Gas = Gas::from_tgas(150);
const GAS_EXECUTE_INTENTS: Gas = Gas::from_tgas(80);
const GAS_ON_SWEPT: Gas = Gas::from_tgas(15);

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Heir {
    pub account_id: AccountId,
    /// Share of every swept token, in basis points (10,000 = 100%).
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
    pub estate_path: String,
    pub estate_public_key: Option<String>,
    pub timer_enabled: bool,
    pub panic_enabled: bool,
    pub change_delay_secs: u64,
    pub pending_testament: Option<PendingTestament>,
    pub pending_modes: Option<PendingModes>,
}

/// A mode change that turns a feature on, waiting for the change delay.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingModes {
    pub timer_enabled: bool,
    pub panic_enabled: bool,
    pub effective_ns: U128,
}

/// A testament change waiting for the change delay to pass.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingTestament {
    pub heirs: Vec<Heir>,
    pub effective_ns: U128,
}

#[near(serializers = [json])]
pub struct Payout {
    pub account_id: AccountId,
    pub amount: U128,
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
    /// The estate key's public half, as registered on the owner's Intents account.
    estate_public_key: Option<String>,
    /// token_id -> total amount successfully swept to the heirs.
    swept: BTreeMap<String, u128>,
    /// Counter mixed into nonces, so two sweeps never share one.
    sweep_count: u64,
    /// Deadswitch: heirs can sweep once the owner stops checking in.
    timer_enabled: bool,
    /// Panic button: the owner can execute the testament at any time.
    panic_enabled: bool,
    /// How long a testament change waits before it takes effect. Fixed at deploy.
    change_delay_ns: u64,
    pending: Option<PendingTestament>,
    /// When the timer last became active; the deadline never starts before it.
    timer_active_since_ns: u64,
    pending_modes: Option<PendingModes>,
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
        timer_enabled: bool,
        panic_enabled: bool,
        change_delay_secs: u64,
    ) -> Self {
        require!(timer_enabled || panic_enabled, "Enable the timer, the panic button, or both");
        require!(!timer_enabled || timeout_secs > 0, "timeout_secs must be greater than 0");
        Self {
            owner,
            heirs: equal_shares(heirs),
            timeout_ns: timeout_secs * NS_PER_SEC,
            last_ping_ns: env::block_timestamp(),
            mpc_contract,
            intents_contract,
            estate_public_key: None,
            swept: BTreeMap::new(),
            sweep_count: 0,
            timer_enabled,
            panic_enabled,
            change_delay_ns: change_delay_secs * NS_PER_SEC,
            pending: None,
            timer_active_since_ns: env::block_timestamp(),
            pending_modes: None,
        }
    }

    // ------------------------------------------------------------------
    // Owner actions (each one also counts as a check-in)
    // ------------------------------------------------------------------

    /// "I'm alive": resets the timer.
    pub fn ping(&mut self) {
        self.owner_check_in();
    }

    /// Heirs with an equal split. Takes effect after the change delay.
    pub fn set_heirs(&mut self, heirs: Vec<AccountId>) {
        self.owner_check_in();
        self.schedule_testament(equal_shares(heirs));
    }

    /// The testament: each heir's share in basis points, adding up to 10,000.
    /// Takes effect after the change delay.
    pub fn set_testament(&mut self, shares: Vec<Heir>) {
        self.owner_check_in();
        validate_shares(&shares);
        self.schedule_testament(shares);
    }

    /// Cancels a testament change that hasn't taken effect yet.
    pub fn cancel_pending_testament(&mut self) {
        self.owner_check_in();
        require!(self.pending.is_some(), "No pending testament change");
        self.pending = None;
    }

    /// Switches the timer and the panic button on or off. At least one must
    /// stay on. A change that only turns features off applies immediately
    /// (and replaces any pending mode change); a change that turns anything
    /// on waits for the change delay.
    pub fn set_modes(&mut self, timer_enabled: bool, panic_enabled: bool) {
        self.owner_check_in();
        self.apply_pending_modes();
        require!(timer_enabled || panic_enabled, "Keep the timer, the panic button, or both");
        let turns_something_on =
            (timer_enabled && !self.timer_enabled) || (panic_enabled && !self.panic_enabled);
        if !turns_something_on || self.change_delay_ns == 0 {
            if timer_enabled && !self.timer_enabled {
                self.timer_active_since_ns = env::block_timestamp();
            }
            self.timer_enabled = timer_enabled;
            self.panic_enabled = panic_enabled;
            self.pending_modes = None;
        } else {
            let effective = env::block_timestamp().saturating_add(self.change_delay_ns);
            self.pending_modes = Some(PendingModes {
                timer_enabled,
                panic_enabled,
                effective_ns: U128(effective as u128),
            });
        }
    }

    /// Cancels a mode change that hasn't taken effect yet.
    pub fn cancel_pending_modes(&mut self) {
        self.owner_check_in();
        self.apply_pending_modes();
        require!(self.pending_modes.is_some(), "No pending mode change");
        self.pending_modes = None;
    }

    /// How long the owner can stay silent before the switch triggers.
    pub fn set_timeout(&mut self, timeout_secs: u64) {
        self.owner_check_in();
        require!(timeout_secs > 0, "timeout_secs must be greater than 0");
        self.timeout_ns = timeout_secs * NS_PER_SEC;
    }

    /// Records the estate key the owner registered on their Intents account
    /// (`add_public_key` on intents.near). It is the MPC-derived key for this
    /// contract and `estate:intents`; a wrong value only makes sweeps fail.
    pub fn set_estate_key(&mut self, public_key: String) {
        self.owner_check_in();
        require!(
            public_key.starts_with("ed25519:") && public_key.len() > 40,
            "public_key must look like ed25519:<base58>"
        );
        self.estate_public_key = Some(public_key);
    }

    // ------------------------------------------------------------------
    // The sweep (after the deadline, callable by anyone)
    // ------------------------------------------------------------------

    /// Pays `amount` of `token_id` from the owner's Intents account to the
    /// heirs, split by the testament. `salt` is the current salt of the
    /// Intents contract (view `current_salt` on intents.near).
    /// Attach 300 Tgas.
    pub fn sweep(&mut self, token_id: String, amount: U128, salt: String) -> Promise {
        self.apply_pending_modes();
        require!(self.timer_enabled, "This switch has no timer; only the owner's panic button can send");
        require!(self.is_triggered(), "Deadline not reached");
        self.start_payout(token_id, amount, salt)
    }

    /// Panic button: the owner executes the testament right now. Same path as
    /// the sweep (MPC-signed intent paying each heir), only callable by the
    /// owner while the switch hasn't triggered. Attach 300 Tgas.
    pub fn send_now(&mut self, token_id: String, amount: U128, salt: String) -> Promise {
        self.apply_pending_modes();
        require!(self.panic_enabled, "The panic button is off for this switch");
        self.owner_check_in();
        self.start_payout(token_id, amount, salt)
    }

    /// Receives the MPC signature and submits the signed intent to NEAR Intents.
    #[private]
    pub fn on_signed(
        &mut self,
        payload: String,
        public_key: String,
        token_id: String,
        amount: U128,
    ) -> PromiseOrValue<bool> {
        self.submit_signed(payload, public_key, token_id, amount)
    }

    /// Records a successful payout.
    #[private]
    pub fn on_swept(&mut self, token_id: String, amount: U128) -> bool {
        self.record_payout(token_id, amount)
    }
}

impl Contract {
    fn start_payout(&mut self, token_id: String, amount: U128, salt: String) -> Promise {
        self.apply_pending();
        let public_key = self
            .estate_public_key
            .clone()
            .unwrap_or_else(|| env::panic_str("The owner has not set the estate key"));
        require!(amount.0 > 0, "amount must be greater than 0");
        let salt_bytes = parse_salt(&salt);

        self.sweep_count += 1;
        let deadline_ms = env::block_timestamp_ms() + INTENT_VALIDITY_MS;
        let mut seed = env::random_seed();
        seed.extend_from_slice(&self.sweep_count.to_le_bytes());
        seed.extend_from_slice(token_id.as_bytes());
        let random = env::sha256(&seed);

        let payouts = split(&self.heirs, amount.0);
        require!(!payouts.is_empty(), "amount is too small to split");
        let payload = build_payload(
            &self.owner,
            &self.intents_contract,
            &iso_timestamp(deadline_ms),
            &versioned_nonce(salt_bytes, deadline_ms, &random),
            &token_id,
            &payouts,
        );
        require!(payload.len() <= MAX_PAYLOAD_BYTES, "Too many heirs for one intent");

        let sign_args = json!({
            "request": {
                "path": ESTATE_PATH,
                "payload_v2": { "Eddsa": hex(payload.as_bytes()) },
                "domain_id": EDDSA_DOMAIN,
            }
        });

        Promise::new(self.mpc_contract.clone())
            .function_call_weight(
                "sign".to_string(),
                serde_json::to_vec(&sign_args).unwrap(),
                ONE_YOCTO,
                GAS_SIGN,
                GasWeight(1),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_SIGNED)
                    .on_signed(payload, public_key, token_id, amount),
            )
    }

    fn submit_signed(
        &mut self,
        payload: String,
        public_key: String,
        token_id: String,
        amount: U128,
    ) -> PromiseOrValue<bool> {
        let signature = env::promise_result_checked(0, MAX_RESULT_BYTES)
            .ok()
            .and_then(|bytes| parse_signature(&bytes));
        let Some(signature) = signature else {
            env::log_str("MPC signing failed; payout cancelled");
            return PromiseOrValue::Value(false);
        };

        let args = json!({
            "signed": [{
                "standard": "raw_ed25519",
                "payload": payload,
                "public_key": public_key,
                "signature": format!("ed25519:{}", base58(&signature)),
            }]
        });

        PromiseOrValue::Promise(
            Promise::new(self.intents_contract.clone())
                .function_call(
                    "execute_intents".to_string(),
                    serde_json::to_vec(&args).unwrap(),
                    NearToken::from_yoctonear(0),
                    GAS_EXECUTE_INTENTS,
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_ON_SWEPT)
                        .on_swept(token_id, amount),
                ),
        )
    }

    fn record_payout(&mut self, token_id: String, amount: U128) -> bool {
        match env::promise_result_checked(0, MAX_RESULT_BYTES) {
            Ok(_) => {
                *self.swept.entry(token_id.clone()).or_insert(0) += amount.0;
                env::log_str(&format!("Sent {} of {} to the heirs", amount.0, token_id));
                true
            }
            Err(_) => {
                env::log_str("NEAR Intents rejected the payout; nothing moved");
                false
            }
        }
    }

}

#[near]
impl Contract {
    // ------------------------------------------------------------------
    // Views (free, read-only)
    // ------------------------------------------------------------------

    pub fn status(&self) -> Status {
        Status {
            owner: self.owner.clone(),
            heirs: self.effective_heirs().to_vec(),
            timeout_secs: self.timeout_ns / NS_PER_SEC,
            last_ping_ns: U128(self.last_ping_ns as u128),
            deadline_ns: U128(self.deadline_ns() as u128),
            now_ns: U128(env::block_timestamp() as u128),
            triggered: self.is_triggered(),
            estate_path: ESTATE_PATH.to_string(),
            estate_public_key: self.estate_public_key.clone(),
            timer_enabled: self.effective_modes().0,
            panic_enabled: self.effective_modes().1,
            change_delay_secs: self.change_delay_ns / NS_PER_SEC,
            pending_testament: self.pending.clone().filter(|p| !self.is_effective(p)),
            pending_modes: self
                .pending_modes
                .clone()
                .filter(|m| (env::block_timestamp() as u128) < m.effective_ns.0),
        }
    }

    /// What each heir would receive from a sweep of `amount`.
    pub fn preview_sweep(&self, amount: U128) -> Vec<Payout> {
        split(self.effective_heirs(), amount.0)
            .into_iter()
            .map(|(account_id, amount)| Payout { account_id, amount: U128(amount) })
            .collect()
    }

    /// Total amount of `token_id` swept to the heirs so far.
    pub fn swept(&self, token_id: String) -> U128 {
        U128(*self.swept.get(&token_id).unwrap_or(&0))
    }

}

impl Contract {
    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    /// (timer on, panic button on, timer active since), counting a pending
    /// mode change once its delay has passed.
    fn effective_modes(&self) -> (bool, bool, u64) {
        match &self.pending_modes {
            Some(m) if (env::block_timestamp() as u128) >= m.effective_ns.0 => {
                let since = if m.timer_enabled && !self.timer_enabled {
                    m.effective_ns.0 as u64
                } else {
                    self.timer_active_since_ns
                };
                (m.timer_enabled, m.panic_enabled, since)
            }
            _ => (self.timer_enabled, self.panic_enabled, self.timer_active_since_ns),
        }
    }

    /// Makes a pending mode change permanent once its delay has passed.
    fn apply_pending_modes(&mut self) {
        let due = self
            .pending_modes
            .as_ref()
            .is_some_and(|m| (env::block_timestamp() as u128) >= m.effective_ns.0);
        if due {
            let (timer, panic, since) = self.effective_modes();
            self.timer_enabled = timer;
            self.panic_enabled = panic;
            self.timer_active_since_ns = since;
            self.pending_modes = None;
        }
    }

    /// The deadline starts from the last check-in, or from when the timer
    /// became active, whichever is later.
    fn deadline_ns(&self) -> u64 {
        let since = self.effective_modes().2;
        self.last_ping_ns.max(since).saturating_add(self.timeout_ns)
    }

    fn is_triggered(&self) -> bool {
        self.effective_modes().0 && env::block_timestamp() >= self.deadline_ns()
    }

    fn is_effective(&self, pending: &PendingTestament) -> bool {
        env::block_timestamp() as u128 >= pending.effective_ns.0
    }

    /// The testament in force right now (a pending change counts once its delay has passed).
    fn effective_heirs(&self) -> &[Heir] {
        match &self.pending {
            Some(p) if self.is_effective(p) => &p.heirs,
            _ => &self.heirs,
        }
    }

    /// Makes a pending change permanent once its delay has passed.
    fn apply_pending(&mut self) {
        if let Some(p) = self.pending.clone() {
            if self.is_effective(&p) {
                self.heirs = p.heirs;
                self.pending = None;
            }
        }
    }

    fn schedule_testament(&mut self, heirs: Vec<Heir>) {
        self.apply_pending();
        if self.change_delay_ns == 0 {
            self.heirs = heirs;
            self.pending = None;
        } else {
            let effective = env::block_timestamp().saturating_add(self.change_delay_ns);
            self.pending = Some(PendingTestament { heirs, effective_ns: U128(effective as u128) });
        }
    }

    /// Checks the caller is the owner and the switch hasn't triggered, then
    /// resets the timer. Once triggered, the switch is final: this protects
    /// heirs if the owner's key is stolen after death.
    fn owner_check_in(&mut self) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can do this");
        require!(!self.is_triggered(), "Switch already triggered; owner actions are disabled");
        self.last_ping_ns = env::block_timestamp();
    }
}

// ----------------------------------------------------------------------
// Pure helpers (unit-tested below)
// ----------------------------------------------------------------------

/// Equal split in basis points; the last heir gets the rounding remainder.
fn equal_shares(accounts: Vec<AccountId>) -> Vec<Heir> {
    require!(!accounts.is_empty(), "At least one heir is required");
    let n = accounts.len() as u32;
    let base = BPS_TOTAL / n;
    let shares: Vec<Heir> = accounts
        .into_iter()
        .enumerate()
        .map(|(i, account_id)| Heir {
            account_id,
            share_bps: if i as u32 == n - 1 { BPS_TOTAL - base * (n - 1) } else { base },
        })
        .collect();
    validate_shares(&shares);
    shares
}

fn validate_shares(shares: &[Heir]) {
    require!(!shares.is_empty(), "At least one heir is required");
    let mut accounts: Vec<&AccountId> = shares.iter().map(|h| &h.account_id).collect();
    accounts.sort();
    accounts.dedup();
    require!(accounts.len() == shares.len(), "Duplicate heirs");
    require!(shares.iter().all(|h| h.share_bps > 0), "Every share must be greater than 0");
    let total: u32 = shares.iter().map(|h| h.share_bps).sum();
    require!(total == BPS_TOTAL, "Shares must add up to 10000 (100%)");
}

/// Each heir's part of `amount`; the last heir gets the rounding remainder.
/// Heirs whose part rounds to 0 are left out.
fn split(heirs: &[Heir], amount: u128) -> Vec<(AccountId, u128)> {
    let total = BPS_TOTAL as u128;
    let mut paid = 0u128;
    let mut out = Vec::new();
    for (i, heir) in heirs.iter().enumerate() {
        let part = if i == heirs.len() - 1 {
            amount - paid
        } else {
            let bps = heir.share_bps as u128;
            amount / total * bps + amount % total * bps / total
        };
        paid += part;
        if part > 0 {
            out.push((heir.account_id.clone(), part));
        }
    }
    out
}

/// The `raw_ed25519` payload NEAR Intents verifies: one transfer per heir.
fn build_payload(
    signer: &AccountId,
    verifying_contract: &AccountId,
    deadline: &str,
    nonce: &str,
    token_id: &str,
    payouts: &[(AccountId, u128)],
) -> String {
    let intents: Vec<Value> = payouts
        .iter()
        .map(|(receiver, amount)| {
            json!({
                "intent": "transfer",
                "receiver_id": receiver,
                "tokens": { token_id: amount.to_string() },
            })
        })
        .collect();
    json!({
        "signer_id": signer,
        "verifying_contract": verifying_contract,
        "deadline": deadline,
        "nonce": nonce,
        "intents": intents,
    })
    .to_string()
}

/// Versioned nonce V1: prefix (4) || version 0 (1) || salt (4) || deadline ns i64 LE (8) || random (15).
fn versioned_nonce(salt: [u8; 4], deadline_ms: u64, random: &[u8]) -> String {
    let mut nonce = Vec::with_capacity(32);
    nonce.extend_from_slice(&VERSIONED_NONCE_PREFIX);
    nonce.push(0);
    nonce.extend_from_slice(&salt);
    nonce.extend_from_slice(&((deadline_ms as i64) * 1_000_000).to_le_bytes());
    nonce.extend_from_slice(&random[..15]);
    match serde_json::to_value(Base64VecU8(nonce)).unwrap() {
        Value::String(s) => s,
        _ => env::panic_str("nonce encoding failed"),
    }
}

fn parse_salt(salt: &str) -> [u8; 4] {
    let s = salt.trim_matches('"');
    require!(s.len() == 8 && s.chars().all(|c| c.is_ascii_hexdigit()), "salt must be 8 hex characters");
    let mut out = [0u8; 4];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

/// Reads `{"scheme":"Ed25519","signature":[64 bytes]}` from the MPC network.
fn parse_signature(bytes: &[u8]) -> Option<Vec<u8>> {
    let value: Value = serde_json::from_slice(bytes).ok()?;
    let sig: Vec<u8> = value
        .get("signature")?
        .as_array()?
        .iter()
        .map(|b| b.as_u64().and_then(|n| u8::try_from(n).ok()))
        .collect::<Option<Vec<u8>>>()?;
    (sig.len() == 64).then_some(sig)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn base58(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let mut digits: Vec<u8> = Vec::new();
    for &byte in bytes {
        let mut carry = byte as u32;
        for d in digits.iter_mut() {
            carry += (*d as u32) << 8;
            *d = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }
    let leading_zeros = bytes.iter().take_while(|&&b| b == 0).count();
    let mut out = String::with_capacity(leading_zeros + digits.len());
    out.extend(std::iter::repeat('1').take(leading_zeros));
    out.extend(digits.iter().rev().map(|&d| ALPHABET[d as usize] as char));
    out
}

/// Milliseconds since 1970 -> "YYYY-MM-DDTHH:MM:SS.mmmZ" (UTC).
fn iso_timestamp(ms: u64) -> String {
    let secs = ms / 1000;
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year,
        month,
        day,
        rem / 3_600,
        rem % 3_600 / 60,
        rem % 60,
        ms % 1000
    )
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
    const TIMEOUT: u64 = 120;
    const KEY: &str = "ed25519:DDLPgZdqFXsG1g7vtwtAvegPAYs4SzLfmT8fWaRJRSZc";

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ctx(caller: &str, now: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("deadswitch.thalderg.near"))
            .predecessor_account_id(acc(caller))
            .block_timestamp(now);
        testing_env!(b.build());
    }

    /// Timer + panic button, no change delay.
    fn setup() -> Contract {
        setup_with(true, true, 0)
    }

    fn setup_with(timer: bool, panic: bool, delay_secs: u64) -> Contract {
        ctx("deadswitch.thalderg.near", T0);
        Contract::new(
            acc("thalderg.near"),
            TIMEOUT,
            vec![acc("anna.near"), acc("marco.near"), acc("luca.near")],
            acc("v1.signer"),
            acc("intents.near"),
            timer,
            panic,
            delay_secs,
        )
    }

    fn with_key(c: &mut Contract, now: u64) {
        ctx("thalderg.near", now);
        c.set_estate_key(KEY.into());
    }

    fn heir(a: &str, bps: u32) -> Heir {
        Heir { account_id: acc(a), share_bps: bps }
    }

    // --- timer and owner rules ---

    #[test]
    fn equal_split_adds_up_to_100_percent() {
        let c = setup();
        let shares: Vec<u32> = c.status().heirs.iter().map(|h| h.share_bps).collect();
        assert_eq!(shares, vec![3333, 3333, 3334]);
    }

    #[test]
    fn triggers_only_after_timeout() {
        let c = setup();
        ctx("anyone.near", T0 + (TIMEOUT - 1) * SEC);
        assert!(!c.status().triggered);
        ctx("anyone.near", T0 + TIMEOUT * SEC);
        assert!(c.status().triggered);
    }

    #[test]
    fn ping_resets_the_timer() {
        let mut c = setup();
        ctx("thalderg.near", T0 + 100 * SEC);
        c.ping();
        ctx("anyone.near", T0 + 150 * SEC);
        assert!(!c.status().triggered);
    }

    #[test]
    #[should_panic(expected = "Only the owner can do this")]
    fn stranger_cannot_ping() {
        let mut c = setup();
        ctx("stranger.near", T0 + SEC);
        c.ping();
    }

    #[test]
    #[should_panic(expected = "owner actions are disabled")]
    fn owner_locked_out_after_trigger() {
        let mut c = setup();
        ctx("thalderg.near", T0 + TIMEOUT * SEC);
        c.ping();
    }

    // --- testament ---

    #[test]
    fn testament_sets_custom_shares() {
        let mut c = setup();
        ctx("thalderg.near", T0 + SEC);
        c.set_testament(vec![heir("anna.near", 7000), heir("marco.near", 3000)]);
        let shares: Vec<u32> = c.status().heirs.iter().map(|h| h.share_bps).collect();
        assert_eq!(shares, vec![7000, 3000]);
    }

    #[test]
    #[should_panic(expected = "Shares must add up to 10000")]
    fn testament_must_add_up_to_100_percent() {
        let mut c = setup();
        ctx("thalderg.near", T0 + SEC);
        c.set_testament(vec![heir("anna.near", 7000), heir("marco.near", 2000)]);
    }

    #[test]
    #[should_panic(expected = "Duplicate heirs")]
    fn testament_refuses_duplicates() {
        let mut c = setup();
        ctx("thalderg.near", T0 + SEC);
        c.set_testament(vec![heir("anna.near", 5000), heir("anna.near", 5000)]);
    }

    #[test]
    #[should_panic(expected = "Only the owner can do this")]
    fn only_owner_sets_testament() {
        let mut c = setup();
        ctx("anna.near", T0 + SEC);
        c.set_testament(vec![heir("anna.near", 10000)]);
    }

    #[test]
    fn split_follows_testament_and_last_gets_remainder() {
        let heirs = vec![heir("anna.near", 7000), heir("marco.near", 3000)];
        let parts = split(&heirs, 1_000_001);
        assert_eq!(parts, vec![(acc("anna.near"), 700_000), (acc("marco.near"), 300_001)]);
        let preview: u128 = split(&heirs, 1_000_001).iter().map(|(_, a)| a).sum();
        assert_eq!(preview, 1_000_001);
    }

    #[test]
    fn split_handles_large_amounts() {
        let heirs = vec![heir("anna.near", 3333), heir("marco.near", 6667)];
        let amount: u128 = 100_000_000_000_000_000_000_000_000_000; // 100k tokens at 24 decimals
        let total: u128 = split(&heirs, amount).iter().map(|(_, a)| a).sum();
        assert_eq!(total, amount);
    }

    // --- sweep rules ---

    #[test]
    #[should_panic(expected = "Deadline not reached")]
    fn sweep_refused_before_deadline() {
        let mut c = setup();
        ctx("thalderg.near", T0 + SEC);
        c.set_estate_key(KEY.into());
        ctx("anyone.near", T0 + 2 * SEC);
        let _ = c.sweep("nep141:wrap.near".into(), U128(100), "252812b3".into());
    }

    #[test]
    #[should_panic(expected = "has not set the estate key")]
    fn sweep_refused_without_estate_key() {
        let mut c = setup();
        ctx("anyone.near", T0 + TIMEOUT * SEC);
        let _ = c.sweep("nep141:wrap.near".into(), U128(100), "252812b3".into());
    }

    #[test]
    fn anyone_can_sweep_after_deadline() {
        let mut c = setup();
        ctx("thalderg.near", T0 + SEC);
        c.set_estate_key(KEY.into());
        ctx("stranger.near", T0 + SEC + TIMEOUT * SEC);
        let _ = c.sweep("nep141:wrap.near".into(), U128(100), "252812b3".into());
        assert_eq!(c.sweep_count, 1);
    }

    #[test]
    #[should_panic(expected = "salt must be 8 hex characters")]
    fn sweep_refuses_bad_salt() {
        let mut c = setup();
        ctx("thalderg.near", T0 + SEC);
        c.set_estate_key(KEY.into());
        ctx("anyone.near", T0 + SEC + TIMEOUT * SEC);
        let _ = c.sweep("nep141:wrap.near".into(), U128(100), "xyz".into());
    }

    #[test]
    #[should_panic(expected = "public_key must look like")]
    fn estate_key_must_be_ed25519() {
        let mut c = setup();
        ctx("thalderg.near", T0 + SEC);
        c.set_estate_key("secp256k1:abc".into());
    }

    // --- the intent the contract signs ---

    #[test]
    fn payload_pays_each_heir_from_the_owner() {
        let heirs = vec![heir("anna.near", 7000), heir("marco.near", 3000)];
        let payload = build_payload(
            &acc("thalderg.near"),
            &acc("intents.near"),
            "2026-11-12T15:30:49.989Z",
            "NONCE",
            "nep141:wrap.near",
            &split(&heirs, 1_000),
        );
        let v: Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(v["signer_id"], "thalderg.near");
        assert_eq!(v["verifying_contract"], "intents.near");
        assert_eq!(v["deadline"], "2026-11-12T15:30:49.989Z");
        let intents = v["intents"].as_array().unwrap();
        assert_eq!(intents.len(), 2);
        assert_eq!(intents[0]["intent"], "transfer");
        assert_eq!(intents[0]["receiver_id"], "anna.near");
        assert_eq!(intents[0]["tokens"]["nep141:wrap.near"], "700");
        assert_eq!(intents[1]["receiver_id"], "marco.near");
        assert_eq!(intents[1]["tokens"]["nep141:wrap.near"], "300");
    }

    #[test]
    fn nonce_is_versioned_v1() {
        let random = [7u8; 32];
        let b64 = versioned_nonce([0x25, 0x28, 0x12, 0xb3], 1_794_497_449_989, &random);
        let Value::String(s) = serde_json::to_value(&b64).unwrap() else { panic!() };
        let bytes: Base64VecU8 = serde_json::from_value(Value::String(s)).unwrap();
        let n = bytes.0;
        assert_eq!(n.len(), 32);
        assert_eq!(&n[..4], &VERSIONED_NONCE_PREFIX);
        assert_eq!(n[4], 0);
        assert_eq!(&n[5..9], &[0x25, 0x28, 0x12, 0xb3]);
        let deadline_ns = i64::from_le_bytes(n[9..17].try_into().unwrap());
        assert_eq!(deadline_ns, 1_794_497_449_989 * 1_000_000);
        assert_eq!(&n[17..], &[7u8; 15]);
        // Same prefix as the real intent accepted on mainnet ("Vij2xgAlKBKz...").
        assert!(b64.starts_with("Vij2xgAlKBKz"));
    }

    #[test]
    fn iso_timestamps() {
        assert_eq!(iso_timestamp(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_timestamp(1_709_208_000_000), "2024-02-29T12:00:00.000Z");
        assert_eq!(iso_timestamp(1_794_497_449_989), "2026-11-12T15:30:49.989Z");
    }

    #[test]
    fn base58_matches_known_values() {
        assert_eq!(base58(b"Hello World!"), "2NEpo7TZRRrLZSi2U");
        assert_eq!(base58(&[0, 0, 1, 2]), "115T");
        // The real signature from the mainnet key test.
        let sig: [u8; 64] = [
            103, 104, 218, 121, 167, 128, 35, 149, 245, 111, 145, 180, 157, 132, 192, 27, 6, 221,
            170, 152, 243, 28, 71, 20, 198, 224, 214, 134, 254, 213, 73, 114, 124, 140, 181, 127,
            175, 163, 52, 210, 170, 93, 237, 242, 177, 66, 119, 8, 205, 219, 212, 78, 241, 241,
            50, 227, 40, 217, 185, 208, 72, 41, 186, 10,
        ];
        assert_eq!(
            base58(&sig),
            "34v2sfhUpA38RbiPDXur5xqmmLE964LmGkryY3f92PbBzonVshiT8YnjjXFpkzUUG3bruSwiiwk1Cg9yEa9LizMf"
        );
    }

    #[test]
    fn parses_mpc_signature() {
        let mut nums = vec!["1"; 64].join(",");
        let ok = format!(r#"{{"scheme":"Ed25519","signature":[{}]}}"#, nums);
        assert_eq!(parse_signature(ok.as_bytes()), Some(vec![1u8; 64]));
        nums = vec!["1"; 63].join(",");
        let short = format!(r#"{{"scheme":"Ed25519","signature":[{}]}}"#, nums);
        assert_eq!(parse_signature(short.as_bytes()), None);
        assert_eq!(parse_signature(b"not json"), None);
    }

    // --- modes: timer, panic button, both ---

    #[test]
    #[should_panic(expected = "Enable the timer, the panic button, or both")]
    fn at_least_one_mode_required() {
        setup_with(false, false, 0);
    }

    #[test]
    fn owner_can_press_panic_button_before_deadline() {
        let mut c = setup();
        with_key(&mut c, T0 + SEC);
        ctx("thalderg.near", T0 + 2 * SEC);
        let _ = c.send_now("nep141:wrap.near".into(), U128(100), "252812b3".into());
        assert_eq!(c.sweep_count, 1);
        assert_eq!(c.last_ping_ns, T0 + 2 * SEC); // pressing it is also a check-in
    }

    #[test]
    #[should_panic(expected = "Only the owner can do this")]
    fn only_owner_can_press_panic_button() {
        let mut c = setup();
        with_key(&mut c, T0 + SEC);
        ctx("anna.near", T0 + 2 * SEC);
        let _ = c.send_now("nep141:wrap.near".into(), U128(100), "252812b3".into());
    }

    #[test]
    #[should_panic(expected = "The panic button is off")]
    fn panic_button_off_in_timer_only_mode() {
        let mut c = setup_with(true, false, 0);
        with_key(&mut c, T0 + SEC);
        ctx("thalderg.near", T0 + 2 * SEC);
        let _ = c.send_now("nep141:wrap.near".into(), U128(100), "252812b3".into());
    }

    #[test]
    #[should_panic(expected = "This switch has no timer")]
    fn no_sweep_in_panic_only_mode() {
        let mut c = setup_with(false, true, 0);
        with_key(&mut c, T0 + SEC);
        ctx("anna.near", T0 + 10 * TIMEOUT * SEC);
        let _ = c.sweep("nep141:wrap.near".into(), U128(100), "252812b3".into());
    }

    #[test]
    fn panic_only_mode_never_triggers() {
        let mut c = setup_with(false, true, 0);
        with_key(&mut c, T0 + SEC);
        ctx("thalderg.near", T0 + 10 * TIMEOUT * SEC);
        assert!(!c.status().triggered);
        let _ = c.send_now("nep141:wrap.near".into(), U128(100), "252812b3".into());
    }

    #[test]
    #[should_panic(expected = "owner actions are disabled")]
    fn panic_button_unavailable_after_trigger() {
        let mut c = setup();
        with_key(&mut c, T0 + SEC);
        ctx("thalderg.near", T0 + SEC + TIMEOUT * SEC);
        let _ = c.send_now("nep141:wrap.near".into(), U128(100), "252812b3".into());
    }

    // --- change delay ---

    #[test]
    fn testament_change_waits_for_the_delay() {
        let mut c = setup_with(true, true, 60);
        ctx("thalderg.near", T0 + SEC);
        c.set_testament(vec![heir("anna.near", 7000), heir("marco.near", 3000)]);

        ctx("anyone.near", T0 + 30 * SEC); // 29 s later: old testament still in force
        assert_eq!(c.status().heirs.len(), 3);
        assert!(c.status().pending_testament.is_some());
        assert_eq!(c.preview_sweep(U128(900))[0].amount.0, 299);

        ctx("anyone.near", T0 + 61 * SEC); // delay passed: new testament in force
        let shares: Vec<u32> = c.status().heirs.iter().map(|h| h.share_bps).collect();
        assert_eq!(shares, vec![7000, 3000]);
        assert!(c.status().pending_testament.is_none());
        assert_eq!(c.preview_sweep(U128(1000))[0].amount.0, 700);
    }

    #[test]
    fn payout_uses_the_new_testament_once_effective() {
        let mut c = setup_with(true, true, 60);
        with_key(&mut c, T0 + SEC);
        ctx("thalderg.near", T0 + 2 * SEC);
        c.set_testament(vec![heir("anna.near", 10000)]);
        ctx("thalderg.near", T0 + 70 * SEC);
        let _ = c.send_now("nep141:wrap.near".into(), U128(100), "252812b3".into());
        assert_eq!(c.heirs, vec![heir("anna.near", 10000)]);
        assert!(c.pending.is_none());
    }

    #[test]
    fn payout_before_the_delay_uses_the_old_testament() {
        let mut c = setup_with(true, true, 60);
        with_key(&mut c, T0 + SEC);
        ctx("thalderg.near", T0 + 2 * SEC);
        c.set_testament(vec![heir("anna.near", 10000)]);
        ctx("thalderg.near", T0 + 10 * SEC);
        let _ = c.send_now("nep141:wrap.near".into(), U128(100), "252812b3".into());
        assert_eq!(c.heirs.len(), 3); // the change is still waiting
        assert!(c.pending.is_some());
    }

    #[test]
    fn owner_can_cancel_a_pending_change() {
        let mut c = setup_with(true, true, 60);
        ctx("thalderg.near", T0 + SEC);
        c.set_testament(vec![heir("anna.near", 10000)]);
        ctx("thalderg.near", T0 + 10 * SEC);
        c.cancel_pending_testament();
        ctx("anyone.near", T0 + 100 * SEC);
        assert_eq!(c.status().heirs.len(), 3);
        assert!(c.status().pending_testament.is_none());
    }

    // --- changing modes later ---

    #[test]
    fn turning_the_panic_button_off_applies_at_once() {
        let mut c = setup_with(true, true, 60);
        ctx("thalderg.near", T0 + SEC);
        c.set_modes(true, false);
        assert!(!c.status().panic_enabled);
        assert!(c.status().pending_modes.is_none());
    }

    #[test]
    #[should_panic(expected = "The panic button is off")]
    fn panic_button_refused_right_after_turning_it_off() {
        let mut c = setup_with(true, true, 60);
        with_key(&mut c, T0 + SEC);
        ctx("thalderg.near", T0 + 2 * SEC);
        c.set_modes(true, false);
        let _ = c.send_now("nep141:wrap.near".into(), U128(100), "252812b3".into());
    }

    #[test]
    fn turning_the_timer_off_applies_at_once_and_disarms_the_switch() {
        let mut c = setup_with(true, true, 60);
        ctx("thalderg.near", T0 + SEC);
        c.set_modes(false, true);
        ctx("anyone.near", T0 + 10 * TIMEOUT * SEC);
        assert!(!c.status().timer_enabled);
        assert!(!c.status().triggered);
    }

    #[test]
    #[should_panic(expected = "Keep the timer, the panic button, or both")]
    fn cannot_turn_everything_off() {
        let mut c = setup_with(true, true, 60);
        ctx("thalderg.near", T0 + SEC);
        c.set_modes(false, false);
    }

    #[test]
    fn turning_the_panic_button_on_waits_for_the_delay() {
        let mut c = setup_with(true, false, 60);
        with_key(&mut c, T0 + SEC);
        ctx("thalderg.near", T0 + 2 * SEC);
        c.set_modes(true, true);
        assert!(!c.status().panic_enabled);
        assert!(c.status().pending_modes.is_some());

        ctx("thalderg.near", T0 + 63 * SEC);
        assert!(c.status().panic_enabled);
        let _ = c.send_now("nep141:wrap.near".into(), U128(100), "252812b3".into());
        assert!(c.pending_modes.is_none());
    }

    #[test]
    #[should_panic(expected = "The panic button is off")]
    fn panic_button_refused_during_the_delay() {
        let mut c = setup_with(true, false, 60);
        with_key(&mut c, T0 + SEC);
        ctx("thalderg.near", T0 + 2 * SEC);
        c.set_modes(true, true);
        ctx("thalderg.near", T0 + 30 * SEC);
        let _ = c.send_now("nep141:wrap.near".into(), U128(100), "252812b3".into());
    }

    #[test]
    fn turning_the_timer_on_starts_a_fresh_countdown() {
        // Panic-only switch; the owner hasn't checked in for a long time.
        let mut c = setup_with(false, true, 60);
        ctx("thalderg.near", T0 + 1_000 * SEC);
        c.set_modes(true, true); // effective at +1060 s, then a full timeout (120 s)
        ctx("anyone.near", T0 + 1_100 * SEC);
        assert!(!c.status().triggered);
        ctx("anyone.near", T0 + 1_179 * SEC);
        assert!(!c.status().triggered);
        ctx("anyone.near", T0 + 1_180 * SEC);
        assert!(c.status().triggered);
    }

    #[test]
    fn a_change_that_adds_and_removes_waits_as_a_whole() {
        let mut c = setup_with(true, false, 60);
        ctx("thalderg.near", T0 + SEC);
        c.set_modes(false, true); // timer off + panic on
        assert!(c.status().timer_enabled);
        assert!(!c.status().panic_enabled);
        ctx("anyone.near", T0 + 62 * SEC);
        assert!(!c.status().timer_enabled);
        assert!(c.status().panic_enabled);
    }

    #[test]
    fn owner_can_cancel_a_pending_mode_change() {
        let mut c = setup_with(true, false, 60);
        ctx("thalderg.near", T0 + SEC);
        c.set_modes(true, true);
        ctx("thalderg.near", T0 + 10 * SEC);
        c.cancel_pending_modes();
        ctx("anyone.near", T0 + 100 * SEC);
        assert!(!c.status().panic_enabled);
        assert!(c.status().pending_modes.is_none());
    }

    #[test]
    fn hex_encoding() {
        assert_eq!(hex(b"{\"a\"}"), "7b2261227d");
    }
}
