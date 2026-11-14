import { CONTRACT_ID, GAS_30, GAS_300, INTENTS_ID, OPERATOR_ID } from '../config';
import type { Heir } from './contract';

export interface Tx {
  receiverId: string;
  actions: { type: 'FunctionCall'; params: { methodName: string; args: object; gas: string; deposit: string } }[];
}

const call = (receiverId: string, methodName: string, args: object = {}, gas = GAS_30, deposit = '0'): Tx => ({
  receiverId,
  actions: [{ type: 'FunctionCall', params: { methodName, args, gas, deposit } }],
});

/* Owner calls on the Deadswitch contract */
export const ping = () => call(CONTRACT_ID, 'ping');
export const setTestament = (shares: Heir[]) => call(CONTRACT_ID, 'set_testament', { shares });
export const cancelPendingTestament = () => call(CONTRACT_ID, 'cancel_pending_testament');
export const setModes = (timer_enabled: boolean, panic_enabled: boolean) =>
  call(CONTRACT_ID, 'set_modes', { timer_enabled, panic_enabled });
export const cancelPendingModes = () => call(CONTRACT_ID, 'cancel_pending_modes');
export const setCheckinOperator = () => call(CONTRACT_ID, 'set_checkin_operator', { account_id: OPERATOR_ID });
export const removeCheckinOperator = () => call(CONTRACT_ID, 'remove_checkin_operator');
export const setTimeout_ = (timeout_secs: number) => call(CONTRACT_ID, 'set_timeout', { timeout_secs });
export const setEstateKey = (public_key: string) => call(CONTRACT_ID, 'set_estate_key', { public_key });
export const sendNow = (token_id: string, amount: string, salt: string) =>
  call(CONTRACT_ID, 'send_now', { token_id, amount, salt }, GAS_300);

/* Anyone, after the deadline */
export const sweep = (token_id: string, amount: string, salt: string) =>
  call(CONTRACT_ID, 'sweep', { token_id, amount, salt }, GAS_300);

/* The owner's NEAR Intents account: exactly 1 yoctoNEAR deposit */
export const addIntentsKey = (public_key: string) => call(INTENTS_ID, 'add_public_key', { public_key }, GAS_30, '1');
export const removeIntentsKey = (public_key: string) => call(INTENTS_ID, 'remove_public_key', { public_key }, GAS_30, '1');
