import { useCallback, useState } from 'react';
import { errorText } from '../near/wallet';
import type { Note } from '../components/ui';

/** Runs one user action at a time, with a busy flag and a success or error note.
 *  After a success, `after` runs again once the chain has had time to finalize
 *  (reads use "final" finality, a couple of seconds behind the transaction). */
export function useAction(after?: () => void) {
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<Note>(null);
  const run = useCallback(async (label: string, fn: () => Promise<Note | void>) => {
    setBusy(label); setNote(null);
    try {
      const n = await fn();
      if (n) setNote(n);
      if (after) { after(); setTimeout(after, 2500); setTimeout(after, 6000); }
    } catch (e) {
      setNote({ kind: 'err', text: errorText(e) });
    } finally {
      setBusy('');
    }
  }, [after]);
  return { busy, note, setNote, run };
}
