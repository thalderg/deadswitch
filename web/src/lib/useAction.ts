import { useCallback, useState } from 'react';
import { errorText } from '../near/wallet';
import type { Note } from '../components/ui';

/** Runs one user action at a time, with a busy flag and a success or error note. */
export function useAction(after?: () => void) {
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<Note>(null);
  const run = useCallback(async (label: string, fn: () => Promise<Note | void>) => {
    setBusy(label); setNote(null);
    try {
      const n = await fn();
      if (n) setNote(n);
      after?.();
    } catch (e) {
      setNote({ kind: 'err', text: errorText(e) });
    } finally {
      setBusy('');
    }
  }, [after]);
  return { busy, note, setNote, run };
}
