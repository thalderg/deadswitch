import { Link } from 'react-router-dom';
import { CONTRACT_ID } from '../config';
import { TopBar } from '../components/Layout';
import { Gate } from './Plan';
import { usePlan } from '../lib/usePlan';
import { bpsToPct, formatAmount, humanDuration, utcDate } from '../lib/format';

/** A one-page summary for the owner's family papers. No keys, nothing secret. */
export function SummaryPage() {
  const { plan, error, loading } = usePlan();
  return (
    <>
      <div className="no-print"><TopBar /></div>
      <Gate need="owner" plan={plan} error={error} loading={loading}>
        {(p) => (
          <article className="center-page print-sheet" style={{ paddingTop: 24 }}>
            <div className="row no-print">
              <button type="button" className="btn primary small" onClick={() => window.print()}>Print or save as PDF</button>
              <Link to="/plan">Back to my plan</Link>
            </div>
            <h1>A plan for {p.status.owner}’s crypto</h1>
            <p className="lead">Printed {utcDate(Date.now())}. This page contains no keys and no passwords. It tells you what happens to these funds and how to receive them.</p>

            <h2 style={{ fontSize: 30 }}>Who receives what</h2>
            <table className="t"><tbody>
              {p.status.heirs.map((h) => <tr key={h.account_id}><th scope="row" style={{ overflowWrap: 'anywhere' }}>{h.account_id}</th><td>{bpsToPct(h.share_bps)}</td></tr>)}
            </tbody></table>

            <h2 style={{ fontSize: 30 }}>Where the funds are</h2>
            <p className="lead">In {p.status.owner}’s own NEAR Intents account. On {utcDate(Date.now())} it held: {p.balances.filter((b) => BigInt(b.amount) > 0n).map((b) => `${formatAmount(b.amount, b.decimals)} ${b.symbol}`).join(', ') || 'nothing yet'}.</p>

            <h2 style={{ fontSize: 30 }}>When it happens</h2>
            <p className="lead">
              {p.status.timer_enabled
                ? <>If {p.status.owner} doesn’t check in for {humanDuration(p.status.timeout_secs * 1000)}, the plan can be carried out. Anyone can do it, and the funds only go to the accounts above.</>
                : <>Only {p.status.owner} can carry out this plan, with the panic button.</>}
            </p>

            <h2 style={{ fontSize: 30 }}>How to receive your share</h2>
            <ol className="lead" style={{ paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <li>Open {location.origin}/heir and connect your NEAR wallet.</li>
              <li>If the plan has run but nobody has carried it out yet, press “Carry out the plan”.</li>
              <li>Open near-intents.org with the same wallet and withdraw your share to your own wallet.</li>
            </ol>
            <p className="small-print">Switch contract: {CONTRACT_ID} on NEAR mainnet. A prototype, not a legal will.</p>
          </article>
        )}
      </Gate>
    </>
  );
}
