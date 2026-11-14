import { useEffect, useRef, type ReactNode } from 'react';
import { EXPLORER_TX } from '../config';

/** A modal built on <dialog>: focus is trapped and Escape closes it. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title}>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

export type Note = { kind: 'ok' | 'err'; text: ReactNode } | null;

export function Notice({ note, onClose }: { note: Note; onClose?: () => void }) {
  if (!note) return null;
  return (
    <div className={`notice ${note.kind}`} role={note.kind === 'err' ? 'alert' : 'status'}>
      <span>{note.text}</span>
      {onClose && <button type="button" className="link-btn" onClick={onClose}>Dismiss</button>}
    </div>
  );
}

export function TxLinks({ hashes }: { hashes: string[] }) {
  if (!hashes.length) return null;
  return (
    <> {hashes.map((h, i) => (
      <a key={h} href={EXPLORER_TX + h} target="_blank" rel="noreferrer">{hashes.length > 1 ? `Transaction ${i + 1}` : 'See the transaction'}</a>
    )).reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, ' · ', el] : [el]), [])}</>
  );
}

export function Check() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10.5l4 4 8-9" /></svg>;
}

export function Cross() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>;
}

/** The breathing ring with a check mark ("Everything is in place"). */
export function CalmRing() {
  return (
    <svg viewBox="0 0 72 72" aria-hidden="true">
      <circle className="breath" cx="36" cy="36" r="30" fill="rgba(127,209,193,.10)" />
      <circle cx="36" cy="36" r="24" fill="none" stroke="#7FD1C1" strokeWidth="2" />
      <path d="M27 37l6 6 12-13" fill="none" stroke="#7FD1C1" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
