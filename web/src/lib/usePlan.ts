import { useCallback, useEffect, useState } from 'react';
import { accountExists } from '../near/rpc';
import { derivedEstateKey, getStatus, hasPublicKey, intentsBalances, previewSweep, type Balance, type Status } from '../near/contract';
import { service, type ServiceSettings } from './service';

export interface Plan {
  status: Status;
  balances: Balance[];
  /** The key the contract signs with, derived by the MPC network. */
  estateKey: string;
  /** The estate key is registered on the owner's NEAR Intents account. */
  permission: boolean;
  /** heir account -> exists on chain */
  heirAccounts: Record<string, boolean>;
  /** token id -> [{account_id, amount}] if the plan ran with today's balance */
  preview: Record<string, { account_id: string; amount: string }[]>;
  /** null when the reminder service isn't reachable */
  settings: ServiceSettings | null;
  /** Local clock minus chain clock, so countdowns follow the chain. */
  clockSkewMs: number;
}

export function usePlan() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const status = await getStatus();
      const [balances, estateKey, settings] = await Promise.all([
        intentsBalances(status.owner),
        derivedEstateKey(),
        service.settings(status.owner).catch(() => null),
      ]);
      const [permission, heirChecks, previews] = await Promise.all([
        hasPublicKey(status.owner, estateKey).catch(() => false),
        Promise.all(status.heirs.map((h) => accountExists(h.account_id))),
        Promise.all(balances.map((b) => (BigInt(b.amount) > 0n ? previewSweep(b.amount) : Promise.resolve([])))),
      ]);
      setPlan({
        status, balances, estateKey, permission, settings,
        heirAccounts: Object.fromEntries(status.heirs.map((h, i) => [h.account_id, heirChecks[i]])),
        preview: Object.fromEntries(balances.map((b, i) => [b.id, previews[i]])),
        clockSkewMs: Date.now() - Number(BigInt(status.now_ns) / 1_000_000n),
      });
      setError('');
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  /* Keep the plan fresh: chain state changes when reminders check you in. */
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  return { plan, error, loading, reload: load };
}
