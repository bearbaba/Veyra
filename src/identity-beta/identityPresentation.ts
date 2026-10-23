/** One public identity (@name.veyra), one immutable internal usr_ database key.
 * Browser storage remembers only a public handle, NEVER an auth session. */
import { normalizeBetaHandle } from './protocol';
const ID_RE = /^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/;
const PREFIX = 'veyra:public-handle:';
export function displayVeyraId(handle: string): string {
  return '@' + normalizeBetaHandle(handle) + '.veyra';
}
export function normalizeFriendLookup(value: string): string {
  const s = value.trim();
  if (ID_RE.test(s)) return s;
  const bare = s.replace(/^@/, '').replace(/\.veyra$/i, '');
  if (bare.includes('.') || bare.includes('@')) throw new Error('Use @friend.veyra, not an X handle.');
  try { return displayVeyraId(bare); }
  catch { throw new Error('Use a Veyra ID such as @friend.veyra.'); }
}
export function shortIdentityReference(value: string): string {
  return ID_RE.test(value) ? 'Member · ' + value.slice(0,8) + '…' + value.slice(-4) : 'Veyra member';
}
export function readKnownHandle(address: string): string | null {
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || typeof localStorage === 'undefined') return null;
    const hint = localStorage.getItem(PREFIX + address.toLowerCase());
    return hint ? normalizeBetaHandle(hint) : null;
  } catch { return null; }
}
export function rememberKnownHandle(address: string, handle: string): void {
  try {
    if (/^0x[0-9a-fA-F]{40}$/.test(address) && typeof localStorage !== 'undefined') {
      localStorage.setItem(PREFIX + address.toLowerCase(), normalizeBetaHandle(handle));
    }
  } catch { /* Private browsing: this is only a convenience hint. */ }
}
