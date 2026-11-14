import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Plan } from '../../lib/usePlan';
import { ago, countdown, leftLabel, nsToMs, passedPct, pctLabel, utcDate, utcDateTime } from '../../lib/format';
import { checkinFree, checkinWithPing } from '../../lib/actions';
import { useWallet } from '../../near/wallet';
import { useAction } from '../../lib/useAction';
import { Notice, TxLinks } from '../ui';

const SOURCE: Record<string, string> = {
  website: 'the website', wallet: 'the website', email: 'an email reminder', telegram: 'a Telegram reminder',
};

/** Where the last check-in came from. The contract can't tell a website check-in through the
 *  operator from a reminder, so the service's record wins when it matches the chain. */
export function checkinSource(plan: Plan): string {
  const lastMs = nsToMs(plan.status.last_ping_ns);
  const rec = plan.settings?.lastCheckin;
  if (rec && Math.abs(rec.atMs - lastMs) < 5 * 60_000) return SOURCE[rec.source] ?? 'a reminder';
  if (plan.status.last_operator_checkin_ns === plan.status.last_ping_ns) return 'a reminder';
  return 'the website';
}

export function StatusHeader({ plan, reload }: { plan: Plan; reload: () => void }) {
  const { status } = plan;
  const wallet = useWallet();
  const [now, setNow] = useState(() => Date.now() - plan.clockSkewMs);
  const [paidReason, setPaidReason] = useState('');
  const { busy, note, setNote, run } = useAction(reload);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() - plan.clockSkewMs), 1000);
    return () => clearInterval(id);
  }, [plan.clockSkewMs]);

  const lastMs = nsToMs(status.last_ping_ns);
  const deadlineMs = nsToMs(status.deadline_ns);
  const triggered = status.triggered || (status.timer_enabled && now >= deadlineMs);
  const passed = passedPct(lastMs, deadlineMs, now);

  const freeCheckin = () => run('checkin', async () => {
    setPaidReason('');
    const out = await checkinFree(wallet);
    if (out.kind === 'needs-paid') { setPaidReason(out.reason); return; }
    if (out.kind === 'free' && out.result.status === 'closed') return { kind: 'err', text: 'Your plan has already run, so check-ins are closed.' };
    return { kind: 'ok', text: 'You’re checked in. Your timer starts again from now. It was free: we paid the network fee.' };
  });
  const paidCheckin = () => run('ping', async () => {
    const hash = await checkinWithPing(wallet);
    setPaidReason('');
    return { kind: 'ok', text: <>You’re checked in from your wallet. <TxLinks hashes={[hash]} /></> };
  });

  if (triggered) {
    return (
      <section className="status" aria-labelledby="dash-title">
        <h1 id="dash-title">Your plan has run</h1>
        <p className="lead">There was no check-in before {utcDateTime(deadlineMs)}, so your switch has triggered. It can’t be changed any more, and anyone can now carry out the plan for the people you chose.</p>
        <div className="row"><Link className="btn primary" to="/heir">See what each person receives</Link></div>
      </section>
    );
  }

  return (
    <section className="status" aria-labelledby="dash-title">
      <div className="status-top">
        <div>
          <h1 id="dash-title">Your plan is active</h1>
          <p className="lead">
            You last checked in {ago(now - lastMs)}, from {checkinSource(plan)}.
            {status.timer_enabled
              ? <> If you don’t check in again, your plan runs on {utcDateTime(deadlineMs)}, in {countdown(deadlineMs - now).replace(/ \d+ (s|min)$/, '')}.</>
              : <> Your timer is off, so your plan only runs if you press the panic button.</>}
          </p>
        </div>
        <div className="row">
          <Link to="/heir">Preview what your heirs will see</Link>
          <button type="button" className="btn primary" disabled={!!busy} onClick={freeCheckin}>
            {busy === 'checkin' ? 'Waiting for your wallet…' : 'Check in'}
          </button>
        </div>
      </div>

      {status.timer_enabled && (
        <>
          <div className="countdown" aria-live="off">{countdown(deadlineMs - now)}
            <small>until your plan runs, on {utcDateTime(deadlineMs)}.</small></div>
          <div className={`track${passed >= 90 ? ' late' : ''}`}>
            <div className="bar" role="meter" aria-label="Time passed since your last check-in"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(passed)}
              aria-valuetext={`${pctLabel(passed)}% of the time passed, ${leftLabel(passed)}% left`}>
              <div className="fill" style={{ width: `${passed}%` }} />
              <div className="dot" style={{ left: `${passed}%` }} />
            </div>
            <div className="track-legend">
              <span>Last check-in: <b>{utcDate(lastMs)}</b></span>
              <span><b>{pctLabel(passed)}% passed</b> · {leftLabel(passed)}% left</span>
              <span>Plan runs: <b>{utcDate(deadlineMs)}</b></span>
            </div>
          </div>
        </>
      )}

      {paidReason ? (
        <div className="notice err" role="alert">
          <span>{paidReason} You can check in straight from your wallet instead. That’s a small transaction: the network fee is a fraction of a cent, paid by you.</span>
          <span className="row">
            <button type="button" className="btn primary small" disabled={!!busy} onClick={paidCheckin}>{busy === 'ping' ? 'Waiting for your wallet…' : 'Check in from my wallet'}</button>
            <button type="button" className="link-btn" onClick={() => setPaidReason('')}>Not now</button>
          </span>
        </div>
      ) : note ? <Notice note={note} onClose={() => setNote(null)} /> : (
        <p className="small-print">Checking in is free: your wallet signs a message, no transaction, and we pay the network fee.</p>
      )}
    </section>
  );
}
