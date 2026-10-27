/**
 * Veyra's human-facing payment alias. This is an application namespace,
 * NOT a DNS name, ENS name or blockchain address.
 *
 * Stored canonical handles remain `alice` (lowercase ASCII). Show the
 * verified, unambiguous recipient alias as `@alice.veyra`.
 * Legacy aliases `@alice` and user-defined contact nicknames remain
 * backward-compatible; only explicit `.veyra` names are Veyra-exclusive.
 */
import { normalizeHandle, HandleNormalizationError } from '../db/handleNormalizer.js';

export const VEYRA_ID_SUFFIX = '.veyra' as const;

export interface RecipientHandleLookup {
  handle: string;
  explicitVeyraId: boolean;
}

export class VeyraIdLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VeyraIdLookupError';
  }
}

/** Does not accept an X alias masquerading as a native .veyra identity. */
export function parseRecipientHandle(rawInput: string): RecipientHandleLookup {
  if (typeof rawInput !== 'string') throw new VeyraIdLookupError('Recipient ID must be text.');
  const input = rawInput.trim();
  if (!input) throw new VeyraIdLookupError('Recipient ID is empty.');
  const noAt = input.startsWith('@') ? input.slice(1) : input;
  const canonicalLower = noAt.toLowerCase();
  if (!canonicalLower.includes(VEYRA_ID_SUFFIX)) {
    // Keep legacy contact aliases and previously supported bare X handles;
    // do not silently change existing contact resolution priority.
    if (!noAt || noAt.includes('@')) throw new VeyraIdLookupError('Invalid recipient ID.');
    return { handle: noAt, explicitVeyraId: false };
  }
  if (!canonicalLower.endsWith(VEYRA_ID_SUFFIX)) {
    throw new VeyraIdLookupError('Invalid Veyra ID namespace. Use @handle.veyra.');
  }
  const candidate = noAt.slice(0, -VEYRA_ID_SUFFIX.length);
  try {
    return { handle: normalizeHandle(candidate), explicitVeyraId: true };
  } catch (error) {
    if (error instanceof HandleNormalizationError) {
      throw new VeyraIdLookupError('Invalid Veyra ID handle. Use 3–30 ASCII letters, digits or underscore.');
    }
    throw error;
  }
}

export function displayVeyraHandle(storedHandle: string): string {
  try {
    return `@${normalizeHandle(storedHandle)}${VEYRA_ID_SUFFIX}`;
  } catch (error) {
    if (error instanceof HandleNormalizationError) {
      throw new VeyraIdLookupError('Stored Veyra handle is invalid.');
    }
    throw error;
  }
}
