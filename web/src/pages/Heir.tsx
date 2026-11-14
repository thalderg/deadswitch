import { TopBar } from '../components/Layout';
import { Gate } from './Plan';
import { usePlan, type Plan } from '../lib/usePlan';
import { useAction } from '../lib/useAction';
import { useWallet } from '../near/wallet';
import { bpsToPct, formatAmount, humanDuration, nsToMs, utcDateTime } from '../lib/format';
import { payoutAll } from '../lib/actions';
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

function HeirView({ plan, reload }: { plan: Plan; reload: () => void }) {
  const { status } = plan;
  const wallet = useWallet();
  const { busy, note, setNote, run } = useAction(reload);
  const funded = plan.balances.filter((b) => BigInt(b.amount) > 0n);
  const amountsFor = (account: string) => funded.flatMap((b) => {
    const p = plan.preview[b.id]?.find((x) => x.account_id === account);
    return p ? [`${formatAmount(p.amount, b.decimals)} ${b.symbol}`] : [];
  }).join(' · ') || '—';
  const canRun = status.triggered && status.timer_enabled;

  return (
    <section className="center-page" aria-labelledby="heir-title" style={{ paddingTop: 40 }}>
      <h1 id="heir-title">{canRun ? `${status.owner} left a plan for you` : 'This plan hasn’t run'}</h1>
      <p className="lead" style={{ fontSize: 19 }}>
        {canRun
          ? <>There was no check-in for {humanDuration(status.timeout_secs * 1000)}, so the switch triggered on {utcDateTime(nsToMs(status.deadline_ns))}. Here is what they chose.</>
          : <>{status.owner} is still checking in{status.timer_enabled ? <>. If that stops, this plan runs on {utcDateTime(nsToMs(status.deadline_ns))} at the earliest</> : ''}. This is what each person would receive with today’s balances.</>}
      </p>
      <table className="t" style={{ fontSize: 17 }}>
        <caption>From {status.owner}’s NEAR Intents account</caption>
        <tbody>
          {status.heirs.map((h) => (
            <tr key={h.account_id} style={h.account_id === wallet.accountId ? { background: 'rgba(127,209,193,.06)' } : undefined}>
              <th scope="row" style={{ overflowWrap: 'anywhere' }}>{h.account_id}{h.account_id === wallet.accountId && <span className="muted" style={{ fontWeight: 400 }}> (you)</span>}</th>
              <td>{amountsFor(h.account_id)}</td>
              <td className="sub">{bpsToPct(h.share_bps)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canRun && (
        funded.length ? (
          <>
            {wallet.accountId ? (
              <button type="button" className="btn primary" style={{ alignSelf: 'flex-start', minHeight: 56, padding: '0 32px', fontSize: 17 }} disabled={!!busy}
                onClick={() => run('sweep', async () => { const h = await payoutAll(wallet, plan.balances, 'sweep'); return { kind: 'ok', text: <>Done. Each person’s share is now in their NEAR Intents account. <TxLinks hashes={h} /></> }; })}>
                {busy ? 'Waiting for your wallet…' : 'Carry out the plan'}
              </button>
            ) : (
              <button type="button" className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => wallet.connect()}>Connect a wallet to carry out the plan</button>
            )}
            <p className="small-print" style={{ fontSize: 15 }}>Anyone can carry out the plan, and funds only go to the accounts listed above. Your wallet needs about 0.31 NEAR available per token for gas; most of it is refunded.</p>
          </>
        ) : <p className="notice ok">The plan has been carried out: the account has nothing left to send.</p>
      )}
      <Notice note={note} onClose={() => setNote(null)} />
      <div className="glass">
        <h2 style={{ fontSize: 28 }}>How to withdraw your share</h2>
        <p className="lead">Your share arrives in your own NEAR Intents account, under your NEAR account name. Open <a href="https://near-intents.org" target="_blank" rel="noreferrer">near-intents.org</a>, connect the same NEAR wallet, and withdraw each token to your own wallet on its network: Bitcoin, Ethereum, Solana or NEAR. You can also swap it there first.</p>
      </div>
    </section>
  );
}
