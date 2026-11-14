import { useEffect, useState } from 'react';
import { TopBar } from '../components/Layout';
import { Gate } from './Plan';
import { usePlan, type Plan } from '../lib/usePlan';
import { useAction } from '../lib/useAction';
import { useWallet } from '../near/wallet';
import { intentsBalancesOf, type Balance } from '../near/contract';
import { bpsToPct, formatAmount, humanDuration, nsToMs, utcDateTime } from '../lib/format';
import { payoutAll } from '../lib/actions';
import { service, type PayoutRecord } from '../lib/service';
import { EXPLORER_TX } from '../config';
import { Notice, TxLinks } from '../components/ui';

export function HeirPage() {
  const { plan, error, loading, reload } = usePlan();
  return (
    <>
      <TopBar />
      <Gate need="any" plan={plan} error={error} loading={loading}>{(p) => <HeirView plan={p} reload={reload} />}</Gate>
    </>
  );
}

const list = (bs: { amount: string; decimals: number; symbol: string }[]) =>
  bs.filter((b) => BigInt(b.amount) > 0n).map((b) => `${formatAmount(b.amount, b.decimals)} ${b.symbol}`).join(' · ') || 'nothing yet';

/** Each person's live NEAR Intents balance, and the payouts the service carried out (refreshed with the plan). */
function useHeirData(plan: Plan) {
  const [holdings, setHoldings] = useState<Record<string, Balance[]>>({});
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);
  useEffect(() => {
    let live = true;
    Promise.all(plan.status.heirs.map((h) => intentsBalancesOf(h.account_id, plan.balances)))
      .then((rs) => { if (live) setHoldings(Object.fromEntries(plan.status.heirs.map((h, i) => [h.account_id, rs[i]]))); })
      .catch(() => {});
    service.payouts().then((r) => { if (live) setPayouts(r.payouts.filter((p) => p.deadlineMs === nsToMs(plan.status.deadline_ns))); }).catch(() => {});
    return () => { live = false; };
  }, [plan]);
  return { holdings, payouts };
}

function HeirView({ plan, reload }: { plan: Plan; reload: () => void }) {
  const { status } = plan;
  const wallet = useWallet();
  const { busy, note, setNote, run } = useAction(reload);
  const { holdings, payouts } = useHeirData(plan);
  const [sweepTx, setSweepTx] = useState<string[]>([]);
  const funded = plan.balances.filter((b) => BigInt(b.amount) > 0n);
  const triggered = status.triggered && status.timer_enabled;
  const meta = (id: string) => plan.balances.find((b) => b.id === id) ?? { symbol: id.replace(/^nep\d+:/, ''), decimals: 0 };

  /* Before it runs: what each would get from today's balances. After: what the payouts sent them. */
  const share = (account: string) => triggered && payouts.length
    ? list(payouts.flatMap((p) => p.payouts.filter((x) => x.account_id === account).map((x) => ({ amount: x.amount, ...meta(p.tokenId) }))))
    : list(funded.flatMap((b) => {
      const p = plan.preview[b.id]?.find((x) => x.account_id === account);
      return p ? [{ amount: p.amount, decimals: b.decimals, symbol: b.symbol }] : [];
    }));
  const txs = [...new Set([...payouts.map((p) => p.tx), ...sweepTx])];

  return (
    <section className="center-page" aria-labelledby="heir-title" style={{ paddingTop: 40 }}>
      <h1 id="heir-title">{triggered ? `${status.owner} left a plan for you` : 'This plan hasn’t run'}</h1>
      <p className="lead" style={{ fontSize: 19 }}>
        {triggered
          ? <>There was no check-in for {humanDuration(status.timeout_secs * 1000)}, so the switch triggered on {utcDateTime(nsToMs(status.deadline_ns))}. Here is what they chose.</>
          : <>{status.owner} is still checking in{status.timer_enabled ? <>. If that stops, this plan runs on {utcDateTime(nsToMs(status.deadline_ns))} at the earliest</> : ''}. This is what each person would receive with today’s balances.</>}
      </p>

      <table className="t" style={{ fontSize: 17 }}>
        <caption>From {status.owner}’s NEAR Intents account</caption>
        <thead>
          <tr>
            <th scope="col" className="muted" style={{ fontWeight: 400, fontSize: 14 }}>Person</th>
            <th scope="col" className="muted" style={{ fontWeight: 400, fontSize: 14, textAlign: 'right' }}>{triggered && payouts.length ? 'Received' : 'Would receive'}</th>
            <th scope="col" className="muted" style={{ fontWeight: 400, fontSize: 14, textAlign: 'right' }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {status.heirs.map((h) => (
            <tr key={h.account_id} style={h.account_id === wallet.accountId ? { background: 'rgba(127,209,193,.06)' } : undefined}>
              <th scope="row" style={{ overflowWrap: 'anywhere' }}>
                {h.account_id}{h.account_id === wallet.accountId && <span className="muted" style={{ fontWeight: 400 }}> (you)</span>}
                <span className="muted" style={{ display: 'block', fontWeight: 400, fontSize: 14, marginTop: 4 }}>
                  In their NEAR Intents account now: {holdings[h.account_id] ? list(holdings[h.account_id]) : '…'}
                </span>
              </th>
              <td>{share(h.account_id)}</td>
              <td className="sub">{bpsToPct(h.share_bps)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {txs.length > 0 && (
        <div className="notice ok" role="status">
          <span>The plan was carried out on NEAR mainnet: {txs.map((h, i) => (
            <span key={h}>{i > 0 && ' · '}<a href={EXPLORER_TX + h} target="_blank" rel="noreferrer">
              {payouts.find((p) => p.tx === h) ? `${meta(payouts.find((p) => p.tx === h)!.tokenId).symbol} transfer` : `Transaction ${i + 1}`}
            </a></span>
          ))}</span>
        </div>
      )}

      {triggered && (
        funded.length ? (
          <>
            {wallet.accountId ? (
              <button type="button" className="btn primary" style={{ alignSelf: 'flex-start', minHeight: 56, padding: '0 32px', fontSize: 17 }} disabled={!!busy}
                onClick={() => run('sweep', async () => { const h = await payoutAll(wallet, plan.balances, 'sweep'); setSweepTx(h); return { kind: 'ok', text: <>Done. Each person’s share is now in their NEAR Intents account. <TxLinks hashes={h} /></> }; })}>
                {busy ? 'Waiting for your wallet…' : 'Carry out the plan'}
              </button>
            ) : (
              <button type="button" className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => wallet.connect()}>Connect a wallet to carry out the plan</button>
            )}
            <p className="small-print" style={{ fontSize: 15 }}>Anyone can carry out the plan, and funds only go to the accounts listed above. The Deadswitch service normally does it within a minute; if not, your wallet needs about 0.31 NEAR available per token for gas, most of it refunded.</p>
          </>
        ) : !txs.length && <p className="notice ok">The plan has been carried out: the account has nothing left to send.</p>
      )}
      <Notice note={note} onClose={() => setNote(null)} />
      <div className="glass">
        <h2 style={{ fontSize: 28 }}>How to withdraw your share</h2>
        <p className="lead">Your share arrives in your own NEAR Intents account, under your NEAR account name. Open <a href="https://near-intents.org" target="_blank" rel="noreferrer">near-intents.org</a>, connect the same NEAR wallet, and withdraw each token to your own wallet on its network: Bitcoin, Ethereum, Solana or NEAR. You can also swap it there first.</p>
      </div>
    </section>
  );
}
