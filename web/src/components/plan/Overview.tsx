import { OPERATOR_ID } from '../../config';
import type { Plan } from '../../lib/usePlan';
import { formatAmount } from '../../lib/format';
import { CalmRing, Check, Cross } from '../ui';

export function healthChecks(plan: Plan) {
  const s = plan.settings;
  return [
    { ok: plan.permission && plan.status.estate_public_key === plan.estateKey, text: 'The switch has its permission', fix: '#permission' },
    { ok: !!s && ((s.emailEnabled && !!s.email) || (s.telegramEnabled && s.telegramLinked)), text: s ? remindersText(plan) : 'Reminders reach you (service not reachable)', fix: '#reminders' },
    { ok: plan.status.checkin_operator === OPERATOR_ID, text: 'Reminders can check you in', fix: '#settings' },
    { ok: Object.values(plan.heirAccounts).every(Boolean), text: 'Every account in your plan exists', fix: '#who' },
    { ok: plan.balances.some((b) => BigInt(b.amount) > 0n), text: 'Your NEAR Intents account holds funds', fix: '#balances' },
  ];
}

function remindersText(plan: Plan) {
  const s = plan.settings!;
  const ch = [s.emailEnabled && s.email && 'email', s.telegramEnabled && s.telegramLinked && 'Telegram'].filter(Boolean);
  return ch.length ? `Reminders reach you by ${ch.join(' and ')}` : 'Reminders reach you';
}

export function Health({ plan }: { plan: Plan }) {
  const checks = healthChecks(plan);
  const allOk = checks.every((c) => c.ok);
  return (
    <section className="glass health span" aria-labelledby="health-title">
      <div className="calm">
        {allOk ? <CalmRing /> : <svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="24" fill="none" stroke="#F6D9BC" strokeWidth="2" /><path d="M36 24v15M36 46v.5" stroke="#F6D9BC" strokeWidth="3" strokeLinecap="round" /></svg>}
        <div>
          <h2 id="health-title">{allOk ? 'Everything is in place' : 'A few things need you'}</h2>
          <p className="muted">{allOk ? 'Your plan is ready for whatever happens. Nothing needs your attention.' : 'Your plan is active, but it works best with everything below ticked.'}</p>
        </div>
      </div>
      <ul className="checks">
        {checks.map((c) => (
          <li key={c.fix + c.text} style={c.ok ? undefined : { color: 'var(--warn-text)' }}>
            {c.ok ? <Check /> : <span style={{ color: 'var(--warn-text)', display: 'contents' }}><Cross /></span>}
            {c.ok ? c.text : <a href={c.fix} style={{ color: 'inherit' }}>{c.text}</a>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Balances({ plan }: { plan: Plan }) {
  const rows = plan.balances.filter((b) => BigInt(b.amount) > 0n);
  return (
    <section className="glass" id="balances" aria-labelledby="bal-title">
      <h2 id="bal-title">Your NEAR Intents account</h2>
      <table className="t">
        <caption>Your funds stay here and keep working as normal.</caption>
        <tbody>
          {rows.length ? rows.map((b) => (
            <tr key={b.id}><th scope="row">{b.symbol}</th><td>{formatAmount(b.amount, b.decimals)}</td></tr>
          )) : <tr><th scope="row" className="muted" style={{ fontWeight: 400 }}>No funds yet</th><td /></tr>}
        </tbody>
      </table>
      <a href="https://near-intents.org" target="_blank" rel="noreferrer" style={{ fontSize: 15 }}>Add funds on NEAR Intents</a>
    </section>
  );
}
