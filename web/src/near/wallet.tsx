import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NearConnector } from '@hot-labs/near-connect';
import { NETWORK, RPC_URL } from '../config';
import type { Tx } from './tx';

export interface SignedMessage { accountId: string; publicKey: string; signature: string }

interface WalletCtx {
  accountId: string;
  loading: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Sends one or more transactions in a single wallet approval; returns the transaction hashes. */
  send: (txs: Tx[]) => Promise<string[]>;
  /** Free NEP-413 signature; null if the wallet can't sign messages. */
  signMessage: (message: string, recipient: string, nonce: Uint8Array) => Promise<SignedMessage | null>;
}

const Ctx = createContext<WalletCtx | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const connector = useMemo(() => new NearConnector({ network: NETWORK, providers: { [NETWORK]: [RPC_URL] } } as never), []);
  const [accountId, setAccountId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const signedIn = ({ accounts }: { accounts: { accountId: string }[] }) => { if (active) setAccountId(accounts[0]?.accountId ?? ''); };
    const signedOut = () => { if (active) setAccountId(''); };
    connector.on('wallet:signIn', signedIn as never);
    connector.on('wallet:signOut', signedOut as never);
    connector.getConnectedWallet()
      .then((c) => { if (active) setAccountId(c?.accounts[0]?.accountId ?? ''); })
      .catch(signedOut)
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      connector.off('wallet:signIn', signedIn as never);
      connector.off('wallet:signOut', signedOut as never);
    };
  }, [connector]);

  const connect = useCallback(async () => { await connector.connect(); }, [connector]);
  const disconnect = useCallback(async () => { await connector.disconnect(); }, [connector]);

  const send = useCallback(async (txs: Tx[]) => {
    const wallet = await connector.wallet();
    const outcomes = await wallet.signAndSendTransactions({ transactions: txs as never });
    for (const o of outcomes as { status?: { Failure?: unknown } }[]) {
      if (o?.status && 'Failure' in o.status) throw new Error(contractError(o.status.Failure));
    }
    return (outcomes as { transaction?: { hash?: string } }[]).map((o) => o?.transaction?.hash ?? '').filter(Boolean);
  }, [connector]);

  const signMessage = useCallback(async (message: string, recipient: string, nonce: Uint8Array) => {
    const wallet = await connector.wallet();
    if (wallet.manifest?.features && !wallet.manifest.features.signMessage) return null;
    try {
      return await wallet.signMessage({ message, recipient, nonce });
    } catch (e) {
      if (isUserRejection(e)) throw e;
      return null;   // the wallet can't sign messages: the caller falls back to a transaction
    }
  }, [connector]);

  /* Development only: `?as=account.near` shows the app as that account, read-only.
     Nothing can be signed or sent in this mode; the real wallet is never involved. */
  const devAs = import.meta.env.DEV ? new URLSearchParams(location.search).get('as') : null;
  if (devAs) {
    const readOnly = async () => { throw new Error('Read-only preview (?as=): connect a real wallet to sign.'); };
    return <Ctx.Provider value={{ accountId: devAs, loading: false, connect, disconnect, send: readOnly, signMessage: readOnly }}>{children}</Ctx.Provider>;
  }

  return <Ctx.Provider value={{ accountId, loading, connect, disconnect, send, signMessage }}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWallet must be used inside WalletProvider');
  return c;
}

export function isUserRejection(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  return m.includes('reject') || m.includes('cancel') || m.includes('denied') || m.includes('closed');
}

/** Turns a contract panic into the sentence inside it. */
export function contractError(failure: unknown): string {
  const text = typeof failure === 'string' ? failure : JSON.stringify(failure);
  const m = text.match(/Smart contract panicked: ([^"\\]+)/) ?? text.match(/panicked at[^:]*: ([^"\\]+)/);
  return m ? m[1].trim() : 'The transaction failed on chain.';
}

/** A message for any error the user should see. */
export function errorText(e: unknown): string {
  if (isUserRejection(e)) return 'You cancelled in your wallet. Nothing was sent.';
  const msg = String((e as Error)?.message ?? e);
  return msg.includes('Smart contract panicked') ? contractError(msg) : msg;
}
