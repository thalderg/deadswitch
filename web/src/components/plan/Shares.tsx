import { useEffect, useMemo, useState } from 'react';
import type { Plan } from '../../lib/usePlan';
import type { Heir } from '../../near/contract';
import { accountExists } from '../../near/rpc';
import * as tx from '../../near/tx';
import { useWallet } from '../../near/wallet';
import { bpsToPct, formatAmount, humanDuration, nsToMs, pctToBps } from '../../lib/format';
import { useAction } from '../../lib/useAction';
import { Dialog, Notice, TxLinks } from '../ui';

/** "If your plan ran today: 0.35 NEAR · 28 USDC" for one heir. */
function todayLine(plan: Plan, account: string) {
  const parts = plan.balances.flatMap((b) => {
    const p = plan.preview[b.id]?.find((x) => x.account_id === account);
    return p && BigInt(p.amount) > 0n ? [`${formatAmount(p.amount, b.decimals)} ${b.symbol}`] : [];
  });
  return parts.length ? `If your plan ran today: ${parts.join(' · ')}` : '';
}

export function Shares({ plan, reload }: { plan: Plan; reload: () => void }) {
  const { status } = plan;
  const wallet = useWallet();
  const [editing, setEditing] = useState(false);
  const { busy, note, setNote, run } = useAction(reload);
  const pending = status.pending_testament;
  const delay = humanDuration(status.change_delay_secs * 1000);

  return (
    <section className="glass" id="who" aria-labelledby="who-title">
      <div className="headrow">
        <h2 id="who-title">Who receives what</h2>
        <button type="button" className="btn secondary small" onClick={() => setEditing(true)}>Edit plan</button>
      </div>
      {status.heirs.map((h) => (
        <div className="share" key={h.account_id}>
          <div className="line"><span style={{ overflowWrap: 'anywhere' }}>{h.account_id}</span><span>{bpsToPct(h.share_bps)}</span></div>
          <div className="sbar"><div style={{ width: `${h.share_bps / 100}%` }} /></div>
          {plan.heirAccounts[h.account_id] === false
            ? <span className="amt" style={{ color: 'var(--warn-text)' }}>This account doesn’t exist. Funds sent to it would be lost: edit your plan.</span>
            : <span className="amt">{todayLine(plan, h.account_id)}</span>}
        </div>
      ))}
      {pending && (
        <div className="pending">
          <p>A change to your plan ({pending.heirs.map((h) => `${h.account_id} ${bpsToPct(h.share_bps)}`).join(', ')}) applies on {new Date(nsToMs(pending.effective_ns)).toUTCString().replace(' GMT', ' UTC')}. Not you? Cancel it now.</p>
          <button type="button" className="btn warn small" disabled={!!busy}
            onClick={() => run('cancel', async () => { const h = await wallet.send([tx.cancelPendingTestament()]); return { kind: 'ok', text: <>The change is cancelled. <TxLinks hashes={h} /></> }; })}>
            {busy === 'cancel' ? 'Waiting for your wallet…' : 'Cancel change'}
          </button>
        </div>
      )}
      <Notice note={note} onClose={() => setNote(null)} />
      <EditPlan open={editing} onClose={() => setEditing(false)} current={pending?.heirs ?? status.heirs} delay={delay}
        onSave={(shares) => run('save', async () => {
          setEditing(false);
          const h = await wallet.send([tx.setTestament(shares)]);
          return { kind: 'ok', text: <>Your change is saved. It applies in {delay}, and you can cancel it until then. <TxLinks hashes={h} /></> };
        })} />
    </section>
  );
}

interface Row { account: string; pct: string }

export function EditPlan({ open, onClose, current, delay, onSave }: {
  open: boolean; onClose: () => void; current: Heir[]; delay: string; onSave: (s: Heir[]) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [exists, setExists] = useState<Record<string, boolean | undefined>>({});

  useEffect(() => {
    if (open) setRows(current.map((h) => ({ account: h.account_id, pct: String(h.share_bps / 100) })));
  }, [open, current]);

  /* Check each account on chain as it's typed (debounced). */
  useEffect(() => {
    const t = setTimeout(() => {
      rows.forEach(({ account }) => {
        const a = account.trim().toLowerCase();
        if (a && exists[a] === undefined) accountExists(a).then((ok) => setExists((e) => ({ ...e, [a]: ok })));
      });
    }, 400);
    return () => clearTimeout(t);
  }, [rows, exists]);

  const parsed = rows.map((r) => ({ account: r.account.trim().toLowerCase(), bps: pctToBps(r.pct) }));
  const total = parsed.reduce((s, r) => s + (r.bps ?? 0), 0);
  const dupes = new Set(parsed.map((r) => r.account)).size !== parsed.length;
  const valid = rows.length > 0 && total === 10000 && !dupes
    && parsed.every((r) => r.account && r.bps !== null && exists[r.account] === true);
  const unchanged = useMemo(() => JSON.stringify(parsed.map((r) => [r.account, r.bps])) === JSON.stringify(current.map((h) => [h.account_id, h.share_bps])), [parsed, current]);

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Dialog open={open} onClose={onClose} title="Edit your plan">
      <p className="small-print" style={{ fontSize: 15 }}>Shares must add up to 100%. The change applies after {delay}, and you can cancel it until then. A backup wallet of your own can be one of the accounts.</p>
      {rows.map((r, i) => {
        const a = r.account.trim().toLowerCase();
        const ok = exists[a];
        return (
          <div className="heir-row" key={i}>
            <input type="text" id={`heir-${i}`} value={r.account} placeholder="name.near" autoComplete="off" spellCheck={false}
              aria-label={`Account ${i + 1}`} onChange={(e) => set(i, { account: e.target.value })} />
            <span className="pct">
              <input type="text" inputMode="decimal" id={`pct-${i}`} value={r.pct} aria-label={`Share for account ${i + 1}, in percent`}
                onChange={(e) => set(i, { pct: e.target.value })} /> %
            </span>
            {a && ok === true && <span className="hint ok">✓ Account found</span>}
            {a && ok === false && <span className="hint bad">No NEAR account with this name. Check the spelling.</span>}
            {rows.length > 1 && <button type="button" className="link-btn" style={{ gridColumn: '1/-1', justifySelf: 'start', fontSize: 14 }}
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        );
      })}
      <p className="total">
        Total: {total / 100}%{total !== 10000 && ` (needs to be 100%)`}{dupes && ' · The same account appears twice.'}
      </p>
      <button type="button" className="link-btn" onClick={() => setRows((rs) => [...rs, { account: '', pct: '' }])}>Add a person or cause</button>
      <div className="actions">
        <button type="button" className="btn primary" disabled={!valid || unchanged}
          onClick={() => onSave(parsed.map((r) => ({ account_id: r.account, share_bps: r.bps! })))}>Save change</button>
        <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
