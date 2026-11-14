import { useState } from 'react';
import type { Plan } from '../../lib/usePlan';
import { service, type ServiceSettings } from '../../lib/service';
import { signRequest } from '../../lib/actions';
import { useWallet } from '../../near/wallet';
import { useAction } from '../../lib/useAction';
import { nsToMs } from '../../lib/format';
import { deadlineIcs, downloadText } from '../../lib/calendar';
import { Notice } from '../ui';

export const SCHEDULE_TEXT = 'Monthly while there’s time, weekly in the last month, every 2 days in the last week, and daily in the last 2 days.';

export function Reminders({ plan, reload }: { plan: Plan; reload: () => void }) {
  const wallet = useWallet();
  const s = plan.settings;
  const deadlineMs = nsToMs(plan.status.deadline_ns);
  const calendar = () => downloadText('deadswitch-deadline.ics', deadlineIcs(deadlineMs, location.origin), 'text/calendar');

  return (
    <section className="glass" id="reminders" aria-labelledby="rem-title">
      <h2 id="rem-title">Reminders</h2>
      <p className="lead">We remind you before your plan runs. Each message shows how long is left, and one tap checks you in.</p>
      {s ? <ReminderSettings s={s} plan={plan} wallet={wallet} reload={reload} />
        : <div className="notice err" role="status"><span>The reminder service isn’t reachable right now. Your plan still works; only reminders and free check-ins are paused.</span></div>}
      <div className="row">
        <button type="button" className="btn secondary small" onClick={calendar}>Add deadline to my calendar</button>
        <span className="small-print">A backup that works even if our messages don’t reach you. If you check in later, the real date only moves later.</span>
      </div>
      <p className="small-print">{SCHEDULE_TEXT} Free during the beta.</p>
    </section>
  );
}

function ReminderSettings({ s, plan, wallet, reload }: { s: ServiceSettings; plan: Plan; wallet: ReturnType<typeof useWallet>; reload: () => void }) {
  const { busy, note, setNote, run } = useAction(reload);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [contacts, setContacts] = useState<Record<string, string>>({});

  const signed = async () => {
    const auth = await signRequest(wallet, 'settings');
    if (!auth) throw new Error('Your wallet can’t sign messages, which changing reminder settings needs. Try another wallet, such as Meteor.');
    return auth;
  };
  const save = (label: string, patch: Parameters<typeof service.saveSettings>[1], ok: string) =>
    run(label, async () => { await service.saveSettings(await signed(), patch); return { kind: 'ok', text: ok }; });

  return (
    <>
      <div className="opts">
        <div>
          <input id="r-email" type="checkbox" checked={s.emailEnabled && !!s.email} disabled={!s.email || !!busy}
            onChange={(e) => save('email', { emailEnabled: e.target.checked }, e.target.checked ? 'Email reminders are on.' : 'Email reminders are off.')} />
          <label htmlFor="r-email"><b>Email</b>
            <span>{s.email ? `${s.email}, verified.` : 'Add an address below. We send a 6-digit code to confirm it.'}</span></label>
        </div>
        {!s.email && (
          <div style={{ display: 'block', borderTop: 0, paddingTop: 0 }}>
            {!codeSent ? (
              <form className="inline-form" onSubmit={(e) => { e.preventDefault(); run('start', async () => { await service.emailStart(await signed(), email.trim()); setCodeSent(true); return { kind: 'ok', text: `We sent a code to ${email.trim()}. It’s valid for 15 minutes.` }; }); }}>
                <label htmlFor="email-in" className="sr-only">Email address</label>
                <input id="email-in" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                <button type="submit" className="btn secondary small" disabled={!!busy}>Send code</button>
              </form>
            ) : (
              <form className="inline-form" onSubmit={(e) => { e.preventDefault(); run('verify', async () => { await service.emailVerify(await signed(), code.trim()); setCodeSent(false); return { kind: 'ok', text: 'Your email is verified. Reminders will reach you there.' }; }); }}>
                <label htmlFor="code-in" className="sr-only">6-digit code</label>
                <input id="code-in" type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
                <button type="submit" className="btn primary small" disabled={!!busy}>Verify</button>
                <button type="button" className="link-btn" onClick={() => setCodeSent(false)}>Use another address</button>
              </form>
            )}
          </div>
        )}
        <div>
          <input id="r-tg" type="checkbox" checked={s.telegramEnabled && s.telegramLinked} disabled={!s.telegramLinked || !!busy}
            onChange={(e) => save('tg', { telegramEnabled: e.target.checked }, e.target.checked ? 'Telegram reminders are on.' : 'Telegram reminders are off.')} />
          <label htmlFor="r-tg"><b>Telegram</b>
            <span>{s.telegramLinked ? 'Linked. Tap “I’m still here” right in the chat.' : 'Not linked yet.'}</span></label>
        </div>
        {!s.telegramLinked && (
          <div style={{ display: 'block', borderTop: 0, paddingTop: 0 }}>
            <button type="button" className="btn secondary small" disabled={!!busy}
              onClick={() => run('link', async () => { const { url } = await service.telegramLink(await signed()); window.open(url, '_blank', 'noopener'); return { kind: 'ok', text: <>Telegram opened. Press Start in the chat with our bot, then come back here: this page updates by itself. If nothing opened: <a href={url} target="_blank" rel="noreferrer">open the link</a>.</> }; })}>
              Link Telegram
            </button>
          </div>
        )}
        <div>
          <input id="r-heirs" type="checkbox" checked={s.notifyHeirs} disabled={!!busy}
            onChange={(e) => save('heirs', { notifyHeirs: e.target.checked }, e.target.checked ? 'The people in your plan will be told when it runs.' : 'The people in your plan won’t be told.')} />
          <label htmlFor="r-heirs"><b>Tell the people in my plan when it runs</b>
            <span>Optional. They get a message with what they received and how to withdraw it.</span></label>
        </div>
        {s.notifyHeirs && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: 0, paddingTop: 0 }}>
            {plan.status.heirs.map((h) => (
              <div className="field" key={h.account_id}>
                <label htmlFor={`c-${h.account_id}`}>Email or Telegram @username for {h.account_id}</label>
                <input id={`c-${h.account_id}`} type="text" placeholder={s.heirContacts[h.account_id] || 'name@example.com or @name'}
                  value={contacts[h.account_id] ?? ''} onChange={(e) => setContacts((c) => ({ ...c, [h.account_id]: e.target.value }))} />
              </div>
            ))}
            <div><button type="button" className="btn secondary small" disabled={!!busy || !Object.values(contacts).some((v) => v.trim())}
              onClick={() => save('contacts', { heirContacts: Object.fromEntries(Object.entries(contacts).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])) }, 'Contacts saved.')}>Save contacts</button></div>
          </div>
        )}
      </div>
      {busy && <p className="small-print">Waiting for your wallet to sign. It’s a free message, not a transaction.</p>}
      <Notice note={note} onClose={() => setNote(null)} />
    </>
  );
}
