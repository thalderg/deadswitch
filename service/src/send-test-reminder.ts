/* Sends one reminder right now, outside the schedule (for testing): `npm run reminder:test`.
   It doesn't count towards the schedule. Its link and button work like a real reminder's. */
import { config } from './config';
import { getStatus } from './near';
import { scheduleFor, sendReminder } from './scheduler';
import { log } from './log';

const s = await getStatus();
if (s.triggered) { log.warn('The plan has already run; no reminder to send.'); process.exit(0); }
const { times, deadline } = scheduleFor(s);
const channels = await sendReminder(s, Date.now(), times, deadline, false);
log.info(channels.length ? `Test reminder sent by ${channels.join(' and ')} (owner ${config.ownerId}).` : 'Nothing sent: link Telegram or verify an email on the dashboard first.');
process.exit(0);
