import { Link } from 'react-router-dom';
import { TopBar } from '../components/Layout';
import { useWallet } from '../near/wallet';
import { usePlan, type Plan } from '../lib/usePlan';
import { StatusHeader } from '../components/plan/StatusHeader';
import { Balances, Health } from '../components/plan/Overview';
import { Shares } from '../components/plan/Shares';
import { Reminders } from '../components/plan/Reminders';
import { Panic, Permission, Settings } from '../components/plan/Controls';

/** Shown instead of a page until the right wallet is connected and the plan is loaded. */
export function Gate({ need, plan, error, loading, children }: {
  need: 'owner' | 'any'; plan: Plan | null; error: string; loading: boolean; children: (p: Plan) => React.ReactNode;
}) {
  const { accountId, connect, loading: walletLoading } = useWallet();
  if (need === 'owner' && !accountId && !walletLoading) {
    return (
      <section className="center-page">
        <h1>Connect your wallet</h1>
        <p className="lead">Connect the NEAR wallet that owns the plan to see it and check in.</p>
        <div className="row"><button type="button" className="btn primary" onClick={() => connect()}>Connect wallet</button></div>
      </section>
    );
  }
  if (error && !plan) return <section className="center-page"><h1>We couldn’t load the plan</h1><p className="lead">{error}</p></section>;
  if (loading && !plan) return <section className="center-page" aria-busy="true"><p className="lead">Reading your plan from NEAR…</p></section>;
  if (!plan) return null;
  if (need === 'owner' && accountId !== plan.status.owner) {
    return (
      <section className="center-page">
        <h1>This plan belongs to {plan.status.owner}</h1>
        <p className="lead">You’re connected as {accountId}. Only the owner can change the plan. If you’re in it, the page for the people in the plan shows what you would receive.</p>
        <div className="row"><Link className="btn primary" to="/heir">See the plan as a recipient</Link></div>
      </section>
    );
  }
  return <>{children(plan)}</>;
}

export function PlanPage() {
  const { plan, error, loading, reload } = usePlan();
  return (
    <>
      <TopBar />
      <Gate need="owner" plan={plan} error={error} loading={loading}>
        {(p) => (
          <>
            {!p.permission && !p.status.triggered && (
              <div className="notice err" role="status" style={{ marginBottom: 8 }}>
                <span>Your plan can’t move funds yet: the switch doesn’t have its permission.</span>
                <Link className="btn primary small" to="/setup">Finish setting up</Link>
              </div>
            )}
            <StatusHeader plan={p} reload={reload} />
            {!p.status.triggered && (
              <div className="grid">
                <Health plan={p} />
                <Balances plan={p} />
                <Shares plan={p} reload={reload} />
                <Reminders plan={p} reload={reload} />
                <Settings plan={p} reload={reload} />
                <Panic plan={p} reload={reload} />
                <Permission plan={p} reload={reload} />
                <section className="glass perm" aria-labelledby="print-title">
                  <div><h2 id="print-title">For your family</h2>
                    <p className="small-print" style={{ fontSize: 15 }}>A one-page summary of your plan to keep with your papers: who receives what, where the funds are, and how to withdraw them. It contains no keys.</p></div>
                  <Link className="btn secondary small" to="/plan/summary">Open printable summary</Link>
                </section>
              </div>
            )}
          </>
        )}
      </Gate>
    </>
  );
}
