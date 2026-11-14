import { describe, expect, it } from 'vitest';
import { Account, KeyPair, KeyPairSigner } from 'near-api-js';
import { signMessage } from 'near-api-js/nep413';
import { verifySigned, type SignedRequest } from './near';

/* A throwaway key and a stubbed chain lookup: the key is a FullAccess key of the account. */
const key = KeyPair.fromRandom('ed25519');
const pub = key.getPublicKey().toString();
const stub = (permission: string) => ({ viewAccessKey: async () => ({ permission }) }) as never;

async function signed(message: string): Promise<SignedRequest> {
  const nonce = new Uint8Array(32).fill(7);
  const acc = new Account('owner.near', 'http://unused', new KeyPairSigner(key));
  const s = await signMessage({ signerAccount: acc, payload: { message, recipient: 'deadswitch', nonce } });
  /* Wallets return the signature base64-encoded; that's what the website forwards. */
  return { accountId: 'owner.near', publicKey: pub, signature: Buffer.from(s.signature).toString('base64'), message, recipient: 'deadswitch', nonce: Buffer.from(nonce).toString('base64') };
}

describe('verifySigned (NEP-413)', () => {
  it('accepts a correct signature from a full-access key', async () => {
    await expect(verifySigned(await signed('Deadswitch check-in for owner.near at 2026-11-14T10:00:00Z'), stub('FullAccess'))).resolves.toBeUndefined();
  });
  it('refuses a changed message', async () => {
    const auth = await signed('Deadswitch check-in for owner.near at 2026-11-14T10:00:00Z');
    auth.message = auth.message.replace('10:00', '11:00');
    await expect(verifySigned(auth, stub('FullAccess'))).rejects.toThrow();
  });
  it('refuses a function-call key', async () => {
    await expect(verifySigned(await signed('x'), stub('FunctionCall'))).rejects.toThrow(/FullAccess/);
  });
});
