import { useState } from 'react';
import { Link } from 'react-router-dom';
import { OPERATOR_ID } from '../config';
import { TopBar } from '../components/Layout';
import { Gate } from './Plan';
import { usePlan, type Plan } from '../lib/usePlan';
import { useAction } from '../lib/useAction';
import { useWallet } from '../near/wallet';
import * as tx from '../near/tx';
import { bpsToPct, humanDuration } from '../lib/format';
import { EditPlan } from '../components/plan/Shares';
import { Reminders } from '../components/plan/Reminders';
import { Notice, TxLinks } from '../components/ui';

const STEPS = ['Connect', 'Who receives what', 'Permission', 'Reminders', 'Reminder check-ins'];

export function SetupPage() {
  const { plan, error, loading, reload } = usePlan();
  const { accountId, connect } = useWallet();
  return (
    <>
      <TopBar />
      {!accountId ? (
        <section className="center-page">
          <Steps current={0} plan={null} />
          <h1>Set up your plan</h1>
          <p className="lead">Five short steps. Your funds never leave your NEAR Intents account. First, connect the NEAR wallet that holds them.</p>
          <div className="row"><button type="button" className="btn primary" onClick={() => connect()}>Connect wallet</button></div>
        </section>
      ) : (
        <Gate need="owner" plan={plan} error={error} loading={loading}>{(p) => <Flow plan={p} reload={reload} />}</Gate>
      )}
    </>
  );
}

function Steps({ current, plan }: { current: number; plan: Plan | null }) {
  const done = plan ? [true, true, plan.permission, !!plan.settings && (plan.settings.emailEnabled || plan.settings.telegramEnabled), plan.status.checkin_operator === OPERATOR_ID || !!plan.status.pending_operator] : [];
  return (
    <ol className="steps-nav" aria-label="Setup steps">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === current ? 'step' : undefined} className={done[i] && i !== current ? 'done' : ''}>
          {i + 1}. {s}{done[i] && i !== current ? ' ✓' : ''}
        </li>
      ))}
    </ol>
  );
}

function Flow({ plan, reload }: { plan: Plan; reload: () => void }) {
  const [step, setStep] = useState(1);
  const wallet = useWallet();
  const [editing, setEditing] = useState(false);
  const { busy, note, setNote, run } = useAction(reload);
  const { status } = plan;
  const delay = humanDuration(status.change_delay_secs * 1000);
  const next = () => { setNote(null); setStep((s) => s + 1); };
  const hasReminder = !!plan.settings && ((plan.settings.emailEnabled && !!plan.settings.email) || (plan.settings.telegramEnabled && plan.settings.telegramLinked));
  const operatorSet = status.checkin_operator === OPERATOR_ID || status.pending_operator?.account_id === OPERATOR_ID;

  return (
    <section className="center-page">
      <Steps current={step} plan={plan} />

      {step === 1 && (<>
        <h1>Who receives what</h1>
        <p className="lead">Split your funds between people, causes, or a backup wallet of your own. Every token you hold is shared the same way.</p>
        <div className="glass">
          {(status.pending_testament?.heirs ?? status.heirs).map((h) => (
            <div className="share" key={h.account_id}>
              <div className="line"><span style={{ overflowWrap: 'anywhere' }}>{h.account_id}</span><span>{bpsToPct(h.share_bps)}</span></div>
              <div className="sbar"><div style={{ width: `${h.share_bps / 100}%` }} /></div>
            </div>
          ))}
          {status.pending_testament && <p className="small-print">This change is waiting: it applies in {delay}.</p>}
        </div>
        <Notice note={note} onClose={() => setNote(null)} />
        <div className="row">
          <button type="button" className="btn primary" onClick={next}>This is right, continue</button>
          <button type="button" className="btn secondary" disabled={!!busy} onClick={() => setEditing(true)}>Change it</button>
        </div>
        <EditPlan open={editing} onClose={() => setEditing(false)} current={status.pending_testament?.heirs ?? status.heirs} delay={delay}
          onSave={(shares) => run('save', async () => {
            setEditing(false);
            const h = await wallet.send([tx.setTestament(shares)]);
            return { kind: 'ok', text: <>Saved. It applies in {delay}; you can continue now. <TxLinks hashes={h} /></> };
          })} />
      </>)}

      {step === 2 && (<>
        <h1>Give the switch its permission</h1>
        <p className="lead">You add one key to your NEAR Intents account. Nobody holds its private half: only NEAR’s MPC network can sign with it, and only when the switch’s rules say so. Your funds don’t move.</p>
        <Notice note={note} onClose={() => setNote(null)} />
        {plan.permission && status.estate_public_key === plan.estateKey ? (
          <div className="row"><span className="notice ok">The switch already has its permission.</span>
            <button type="button" className="btn primary" onClick={next}>Continue</button></div>
        ) : (
          <div className="row">
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => run('perm', async () => {
              const txs = [];
              if (!plan.permission) txs.push(tx.addIntentsKey(plan.estateKey));
              if (status.estate_public_key !== plan.estateKey) txs.push(tx.setEstateKey(plan.estateKey));
              const h = await wallet.send(txs);
              return { kind: 'ok', text: <>Done. <TxLinks hashes={h} /></> };
            })}>{busy ? 'Waiting for your wallet…' : 'Give permission'}</button>
            <span className="small-print">Two small transactions in one approval. Adding the key costs 1 yoctoNEAR.</span>
          </div>
        )}
      </>)}

      {step === 3 && (<>
        <h1>How should we remind you?</h1>
        <p className="lead">Before your timer runs out, we send a reminder. One tap on “I’m still here” checks you in: no wallet, no fee. Both are optional.</p>
        <Reminders plan={plan} reload={reload} />
        {!hasReminder && <div className="notice err"><span>Without reminders, only your own check-ins on this website keep your plan from running.</span></div>}
        <div className="row"><button type="button" className="btn primary" onClick={next}>{hasReminder ? 'Continue' : 'Continue without reminders'}</button></div>
      </>)}

      {step === 4 && (<>
        <h1>Allow reminder check-ins</h1>
        <p className="lead">This lets our reminder service reset your timer when you tap “I’m still here”, and makes checking in on this website free. It can’t do anything else: it can’t move funds or change your plan. Turning it on waits {delay}, like every change that adds power.</p>
        <Notice note={note} onClose={() => setNote(null)} />
        {operatorSet ? (
          <div className="row"><span className="notice ok">{status.checkin_operator === OPERATOR_ID ? 'Reminder check-ins are allowed.' : `Reminder check-ins turn on in ${delay}.`}</span>
            <button type="button" className="btn primary" onClick={next}>Finish</button></div>
        ) : (
          <div className="row">
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => run('op', async () => { const h = await wallet.send([tx.setCheckinOperator()]); return { kind: 'ok', text: <>Saved. <TxLinks hashes={h} /></> }; })}>
              {busy ? 'Waiting for your wallet…' : 'Allow reminder check-ins'}</button>
            <button type="button" className="link-btn" onClick={next}>Skip</button>
          </div>
        )}
      </>)}

      {step >= 5 && (<>
        <h1>Your plan is set</h1>
        <p className="lead">Keep living your life. We’ll remind you before your timer runs out, and you can check in, change your plan or press the panic button on your dashboard.</p>
        <div className="row"><Link className="btn primary" to="/plan">Go to my plan</Link></div>
      </>)}

      {step > 1 && step < 5 && <button type="button" className="link-btn" onClick={() => setStep((s) => s - 1)}>Back</button>}
    </section>
  );
}
