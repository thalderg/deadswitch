import { config, describeConfig } from './config';
import { operatorBalanceNear } from './near';
import { startHttp } from './http';
import { startScheduler } from './scheduler';
import { startTelegram } from './telegram';
import { log } from './log';

log.info(`Deadswitch reminder service · ${describeConfig()}`);
try {
  const near = await operatorBalanceNear();
  log.info(`Check-in operator ${config.operatorId} holds ${near} NEAR.`);
  if (near < 0.1) log.warn(`That's below 0.1 NEAR. Top it up: it pays every check-in and sweep.`);
} catch (e) {
  log.warn(`Couldn't read the operator's balance: ${(e as Error).message}`);
}
startHttp();
startScheduler();
void startTelegram();
