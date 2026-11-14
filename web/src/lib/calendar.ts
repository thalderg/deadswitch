/** An .ics file with the plan's deadline and two alarms before it. */
export function deadlineIcs(deadlineMs: number, siteUrl: string): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Deadswitch//Check-in deadline//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:deadswitch-${deadlineMs}@deadswitch`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(deadlineMs - 30 * 60_000)}`,
    `DTEND:${stamp(deadlineMs)}`,
    'SUMMARY:Check in on Deadswitch before your plan runs',
    `DESCRIPTION:Your plan runs at the end of this event unless you check in. Check in at ${siteUrl}/plan`,
    `URL:${siteUrl}/plan`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Your Deadswitch plan runs in 2 days', 'TRIGGER:-P2D', 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Your Deadswitch plan runs tomorrow', 'TRIGGER:-P1D', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
