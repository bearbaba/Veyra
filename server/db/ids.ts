/**
 * Prefixed ID generator for all Veyra entities.
 * Uses crypto.randomBytes for a cryptographically unique base58 suffix.
 * Never uses timestamps or sequential counters.
 */
import { randomBytes } from 'crypto';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function toBase58(buf: Buffer): string {
  let num = BigInt('0x' + buf.toString('hex'));
  const result: string[] = [];
  const base = BigInt(58);
  while (num > 0n) {
    result.unshift(BASE58_ALPHABET[Number(num % base)]!);
    num = num / base;
  }
  // Preserve leading zeros
  for (const byte of buf) {
    if (byte !== 0) break;
    result.unshift('1');
  }
  return result.join('');
}

function makeId(prefix: string, byteLength = 20): string {
  return `${prefix}${toBase58(randomBytes(byteLength))}`;
}

export const newUserId         = () => makeId('usr_');
export const newWalletId       = () => makeId('wlt_');
export const newLinkedId       = () => makeId('lid_');
export const newSnapshotId     = () => makeId('snp_');
export const newPreferenceId   = () => makeId('rcp_');
export const newFollowId       = () => makeId('flw_');
export const newConnectionId   = () => makeId('con_');
export const newBlockId        = () => makeId('blk_');
export const newReceiptId      = () => makeId('rec_');
export const newEventId        = () => makeId('evt_');
export const newRevisionId     = () => makeId('rev_');
export const newPostId         = () => makeId('pst_');
export const newInteractionId  = () => makeId('pin_');
export const newTipId          = () => makeId('ptp_');
export const newHandleHistId   = () => makeId('hdl_');
export const newQuoteId        = () => makeId('quo_');
export const newIntentId       = () => makeId('int_');
export const newChallengeId    = () => makeId('chl_');
export const newOAuthStateId   = () => makeId('oas_');
export const newContactId      = () => makeId('ctc_');

/**
 * Server-issued client intent ID (amendment 5).
 * Uses crypto.randomUUID() — cryptographically unique, not timestamp-derived.
 * The BFF issues this and rejects any client-supplied value that does not
 * match the UUID v4 format /^[0-9a-f]{8}-...-4...-[89ab]...-...$/.
 */
export const newClientIntentId = (): string => crypto.randomUUID();

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isValidClientIntentId = (id: string): boolean => UUID_V4_RE.test(id);
