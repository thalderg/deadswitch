// Deadswitch: test that NEAR Intents accepts an intent signed by the MPC network
// through the deadswitch contract (raw_ed25519 standard). No npm packages needed.
//
// Step 1:  node intents-key-test.mjs build  <signer> <receiver> <token_id> <amount> <salt_hex>
//          -> writes intent-payload.json and intent-payload.hex (the bytes to sign, as hex)
// Step 2:  node intents-key-test.mjs finish <public_key> "<signature numbers>"
//          -> writes execute-args.json for simulate_intents / execute_intents

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const PAYLOAD_FILE = "intent-payload.json";
const ARGS_FILE = "execute-args.json";
const HEX_FILE = "intent-payload.hex";
const DEADLINE_MINUTES = 30;

// Versioned nonce V1 (from the NEAR Intents source):
// MAGIC (4) || version 0 (1) || salt (4) || deadline ns as i64 LE (8) || random (15) = 32 bytes
const VERSIONED_MAGIC_PREFIX = Buffer.from("5628f6c6", "hex");

function versionedNonce(saltHex, deadlineMs) {
    const salt = Buffer.from(saltHex.replace(/^"|"$/g, ""), "hex");
    if (salt.length !== 4) throw new Error(`Salt must be 4 bytes of hex, got "${saltHex}"`);
    const deadline = Buffer.alloc(8);
    deadline.writeBigInt64LE(BigInt(deadlineMs) * 1_000_000n);
    const nonce = Buffer.concat([VERSIONED_MAGIC_PREFIX, Buffer.from([0]), salt, deadline, randomBytes(15)]);
    if (nonce.length !== 32) throw new Error("Nonce must be 32 bytes");
    return nonce.toString("base64");
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
    let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0"));
    let out = "";
    while (n > 0n) {
        out = B58[Number(n % 58n)] + out;
        n /= 58n;
    }
    for (const b of bytes) {
        if (b !== 0) break;
        out = "1" + out;
    }
    return out;
}

const [command, ...args] = process.argv.slice(2);

if (command === "build") {
    const [signer, receiver, token, amount, salt] = args;
    if (!salt) {
        console.error("Usage: node intents-key-test.mjs build <signer> <receiver> <token_id> <amount> <salt_hex>");
        process.exit(1);
    }
    const deadlineMs = Date.now() + DEADLINE_MINUTES * 60_000;
    const payload = JSON.stringify({
        signer_id: signer,
        verifying_contract: "intents.near",
        deadline: new Date(deadlineMs).toISOString(),
        nonce: versionedNonce(salt, deadlineMs),
        intents: [{ intent: "transfer", receiver_id: receiver, tokens: { [token]: amount } }],
    });
    writeFileSync(PAYLOAD_FILE, JSON.stringify({ payload }, null, 2));
    console.log("Intent to sign:\n" + payload + "\n");
    console.log(`Valid for ${DEADLINE_MINUTES} minutes. Payload as hex (${payload.length} bytes):\n`);
    const hex = Buffer.from(payload, "utf8").toString("hex");
    writeFileSync(HEX_FILE, hex);
    console.log(hex + `\n\n(also saved to ${HEX_FILE})`);
} else if (command === "finish") {
    const [publicKey, sigText] = args;
    if (!sigText) {
        console.error('Usage: node intents-key-test.mjs finish <ed25519:public_key> "<signature numbers>"');
        process.exit(1);
    }
    const sig = (sigText.match(/\d+/g) || []).map(Number);
    if (sig.length !== 64 || sig.some((b) => b > 255)) {
        throw new Error(`Expected 64 signature bytes, got ${sig.length}`);
    }
    const { payload } = JSON.parse(readFileSync(PAYLOAD_FILE, "utf8"));
    const executeArgs = {
        signed: [
            {
                standard: "raw_ed25519",
                payload,
                public_key: publicKey,
                signature: "ed25519:" + base58(sig),
            },
        ],
    };
    writeFileSync(ARGS_FILE, JSON.stringify(executeArgs));
    console.log(`Wrote ${ARGS_FILE}:\n` + JSON.stringify(executeArgs, null, 2));
} else {
    console.error("Commands: build | finish");
    process.exit(1);
}