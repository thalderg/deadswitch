import { useState } from 'react';
import { OPERATOR_ID } from '../../config';
import type { Plan } from '../../lib/usePlan';
import * as tx from '../../near/tx';
import { useWallet } from '../../near/wallet';
import { bpsToPct, formatAmount, humanDuration, nsToMs, shortKey, utcDateTime } from '../../lib/format';
import { payoutAll } from '../../lib/actions';
import { useAction } from '../../lib/useAction';
import { Dialog, Notice, TxLinks } from '../ui';

const USUAL_KEY = 'deadswitch.usualTimeoutSecs';
const readUsual = () => { try { return Number(localStorage.getItem(USUAL_KEY)) || 0; } catch { return 0; } };
const writeUsual = (v: number | null) => { try { v ? localStorage.setItem(USUAL_KEY, String(v)) : localStorage.removeItem(USUAL_KEY); } catch { /* storage off */ } };

export function Settings({ plan, reload }: { plan: Plan; reload: () => void }) {
  const { status } = plan;
  const wallet = useWallet();
  const { busy, note, setNote, run } = useAction(reload);
  const delay = humanDuration(status.change_delay_secs * 1000);
  const operatorOn = status.checkin_operator === OPERATOR_ID;
  const operatorPending = status.pending_operator?.account_id === OPERATOR_ID;
  const [away, setAway] = useState(90);
  const usual = readUsual();

  const sendOne = (label: string, t: tx.Tx, ok: string) =>
    run(label, async () => { const h = await wallet.send([t]); return { kind: 'ok', text: <>{ok} <TxLinks hashes={h} /></> }; });

  const toggleMode = (which: 'timer' | 'panic', on: boolean) => {
    const timer = which === 'timer' ? on : status.timer_enabled;
    const panic = which === 'panic' ? on : status.panic_enabled;
    sendOne(which, tx.setModes(timer, panic), on ? `Saved. It turns on in ${delay}.` : 'Turned off.');
  };

  /* Travel: lengthen the check-in period to cover the trip plus two weeks; remember the usual one. */
  const travel = () => {
    const secs = away * 86400 + 14 * 86400;
    if (secs <= status.timeout_secs) { setNote({ kind: 'ok', text: 'Your check-in period is already longer than that trip. Nothing to change.' }); return; }
    run('travel', async () => {
      const h = await wallet.send([tx.setTimeout_(secs)]);
      if (!usual) writeUsual(status.timeout_secs);
      return { kind: 'ok', text: <>Done: you now have {humanDuration(secs * 1000)} between check-ins. When you’re back, set it back here. <TxLinks hashes={h} /></> };
    });
  };
  const backHome = () => run('back', async () => {
    const h = await wallet.send([tx.setTimeout_(usual)]);
    writeUsual(null);
    return { kind: 'ok', text: <>Welcome back. Your check-in period is {humanDuration(usual * 1000)} again. <TxLinks hashes={h} /></> };
  });

  return (
    <section className="glass" id="settings" aria-labelledby="set-title">
      <h2 id="set-title">Settings</h2>
      <div className="opts">
        <div>
          <input id="s-timer" type="checkbox" checked={status.timer_enabled} disabled={!!busy || (status.timer_enabled && !status.panic_enabled)}
            onChange={(e) => toggleMode('timer', e.target.checked)} />
          <label htmlFor="s-timer"><b>Carry out my plan if I stop checking in</b>
            <span>After {humanDuration(status.timeout_secs * 1000)} without a check-in, the people you chose receive their shares.{status.timer_enabled && !status.panic_enabled && ' To turn this off, first turn on the button below: one of them must stay on.'}</span></label>
        </div>
        <div>
          <input id="s-panic" type="checkbox" checked={status.panic_enabled} disabled={!!busy || (status.panic_enabled && !status.timer_enabled)}
            onChange={(e) => toggleMode('panic', e.target.checked)} />
          <label htmlFor="s-panic"><b>Let me move everything at once</b>
            <span>Adds a button that sends everything to the people in your plan immediately.</span></label>
        </div>
        <div>
          <input id="s-op" type="checkbox" checked={operatorOn || operatorPending} disabled={!!busy}
            onChange={(e) => (e.target.checked
              ? sendOne('op', tx.setCheckinOperator(), `Saved. Reminders can check you in after ${delay}.`)
              : sendOne('op', tx.removeCheckinOperator(), 'Turned off. Reminders can no longer check you in.'))} />
          <label htmlFor="s-op"><b>Let reminders check me in</b>
            <span>Allows the Deadswitch reminder service to reset your timer when you tap a reminder. It can’t do anything else. It also makes checking in on this website free.</span></label>
        </div>
      </div>
      {status.pending_modes && (
        <div className="pending">
          <p>Turning on {[status.pending_modes.timer_enabled && !status.timer_enabled && 'the timer', status.pending_modes.panic_enabled && !status.panic_enabled && 'the panic button'].filter(Boolean).join(' and ')} applies on {utcDateTime(nsToMs(status.pending_modes.effective_ns))}. Not you? Cancel it now.</p>
          <button type="button" className="btn warn small" disabled={!!busy} onClick={() => sendOne('cm', tx.cancelPendingModes(), 'The change is cancelled.')}>Cancel change</button>
        </div>
      )}
      {operatorPending && !operatorOn && (
        <div className="pending">
          <p>Reminder check-ins turn on {utcDateTime(nsToMs(status.pending_operator!.effective_ns))}. Not you? Cancel it now.</p>
          <button type="button" className="btn warn small" disabled={!!busy} onClick={() => sendOne('co', tx.removeCheckinOperator(), 'The change is cancelled.')}>Cancel change</button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 16, borderTop: '1px solid var(--rule)' }}>
        <b style={{ fontSize: 17, fontWeight: 500 }}>Going somewhere without signal?</b>
        {usual && usual < status.timeout_secs ? (
          <>
            <span className="small-print" style={{ fontSize: 15 }}>Your check-in period is {humanDuration(status.timeout_secs * 1000)} for your trip. It’s usually {humanDuration(usual * 1000)}.</span>
            <div className="travel"><button type="button" className="btn secondary small" disabled={!!busy} onClick={backHome}>I’m back: set it to {humanDuration(usual * 1000)}</button></div>
          </>
        ) : (
          <>
            <span className="small-print" style={{ fontSize: 15 }}>Give yourself more time before your plan runs, so a long trip doesn’t set it off. You set it back when you return.</span>
            <div className="travel">
              <label htmlFor="travel-len" className="small-print">I’ll be away for</label>
              <select id="travel-len" value={away} onChange={(e) => setAway(Number(e.target.value))}>
                <option value={30}>1 month</option><option value={90}>3 months</option><option value={180}>6 months</option>
              </select>
              <button type="button" className="btn secondary small" disabled={!!busy} onClick={travel}>Extend my timer</button>
            </div>
          </>
        )}
      </div>
      <Notice note={note} onClose={() => setNote(null)} />
      <p className="small-print">Turning something off applies right away. Turning something on, or changing your plan, waits {delay}.</p>
    </section>
  );
}

export function Panic({ plan, reload }: { plan: Plan; reload: () => void }) {
  const { status } = plan;
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const { busy, note, setNote, run } = useAction(reload);
  const funded = plan.balances.filter((b) => BigInt(b.amount) > 0n);
  const amounts = funded.map((b) => `${formatAmount(b.amount, b.decimals)} ${b.symbol}`).join(', ') || 'nothing';
  const heirs = status.heirs.map((h) => `${h.account_id} (${bpsToPct(h.share_bps)})`).join(' and ');
  const blocked = !status.panic_enabled ? 'The panic button is off in your settings.'
    : !plan.permission ? 'The switch needs its permission first (see below).'
      : !funded.length ? 'Your NEAR Intents account is empty.' : '';

  return (
    <section className="glass panic span" id="panic" aria-labelledby="panic-title">
      <h2 id="panic-title">Move everything now</h2>
      <p className="lead">If you think your keys have been exposed, send all your funds to the people in your plan right now, before anyone else can move them.</p>
      <button type="button" className="btn ember" disabled={!!blocked || !!busy} onClick={() => setOpen(true)}>
        {busy ? 'Waiting for your wallet…' : 'Send everything to my plan'}
      </button>
      {blocked && <p className="small-print">{blocked}</p>}
      <Notice note={note} onClose={() => setNote(null)} />
      <p className="small-print">This can’t be undone. Funds only go to the accounts in your plan. Each token is one transaction of up to 300 Tgas; most of the gas is refunded.</p>
      <Dialog open={open} onClose={() => setOpen(false)} title="Send everything to your plan?">
        <p className="lead">This sends {amounts} to {heirs} now. It can’t be undone.</p>
        <div className="actions">
          <button type="button" className="btn ember" onClick={() => {
            setOpen(false);
            run('panic', async () => { const h = await payoutAll(wallet, plan.balances, 'send_now'); return { kind: 'ok', text: <>Sent. Your funds are on their way to the people in your plan. <TxLinks hashes={h} /></> }; });
          }}>Send everything</button>
          <button type="button" className="btn secondary" autoFocus onClick={() => setOpen(false)}>Keep my funds</button>
        </div>
      </Dialog>
    </section>
  );
}

export function Permission({ plan, reload }: { plan: Plan; reload: () => void }) {
  const wallet = useWallet();
  const [confirm, setConfirm] = useState(false);
  const { busy, note, setNote, run } = useAction(reload);
  const recorded = plan.status.estate_public_key === plan.estateKey;

  const add = () => run('add', async () => {
    const txs = [tx.addIntentsKey(plan.estateKey)];
    if (!recorded) txs.push(tx.setEstateKey(plan.estateKey));
    const h = await wallet.send(txs);
    return { kind: 'ok', text: <>The switch has its permission. Your funds didn’t move. <TxLinks hashes={h} /></> };
  });
  const remove = () => run('remove', async () => {
    setConfirm(false);
    const h = await wallet.send([tx.removeIntentsKey(plan.estateKey)]);
    return { kind: 'ok', text: <>Permission removed. Your plan can’t move funds until you add it again. <TxLinks hashes={h} /></> };
  });

  return (
    <section className="glass perm" id="permission" aria-labelledby="perm-title">
      <div>
        <h2 id="perm-title">Permission</h2>
        <p className="small-print" style={{ fontSize: 15 }}>
          {plan.permission
            ? <>The switch’s key <span className="mono">{shortKey(plan.estateKey)}</span> is on your NEAR Intents account. Nobody holds its private half.{!recorded && ' The contract doesn’t know this key yet: add the permission again to record it.'}</>
            : <>The switch can’t carry out your plan yet. Add one key to your NEAR Intents account: nobody holds it, and your funds don’t move. It costs 1 yoctoNEAR plus a small network fee.</>}
        </p>
        <Notice note={note} onClose={() => setNote(null)} />
      </div>
      {plan.permission && recorded
        ? <button type="button" className="btn secondary small" disabled={!!busy} onClick={() => setConfirm(true)}>Remove permission</button>
        : <button type="button" className="btn primary small" disabled={!!busy} onClick={add}>{busy ? 'Waiting for your wallet…' : 'Add permission'}</button>}
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Remove the permission?">
        <p className="lead">Without it, your plan can’t send anything: not when the timer runs out, and not with the panic button. Your funds stay where they are.</p>
        <div className="actions">
          <button type="button" className="btn secondary" onClick={remove}>Remove permission</button>
          <button type="button" className="btn primary" autoFocus onClick={() => setConfirm(false)}>Keep it</button>
        </div>
      </Dialog>
    </section>
  );
}
