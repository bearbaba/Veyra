/**
 * Handle normalizer (amendment 1).
 *
 * Rules:
 *  - Lowercase only (case-insensitive uniqueness via LOWER() index in Postgres).
 *  - max 30 chars, min 3 chars.
 *  - Allowed characters: [a-z0-9_] only.
 *  - Unicode confusable defense: strip/reject any codepoint outside ASCII [0x20-0x7e]
 *    before the pattern check so Cyrillic, Greek, and other lookalikes are rejected.
 *  - Leading/trailing underscores rejected.
 *  - Consecutive underscores rejected.
 *
 * normalizeHandle() returns the canonical stored form or throws HandleNormalizationError.
 * isHandleAvailable() checks the handle_history reservation window via the DB.
 */

export class HandleNormalizationError extends Error {
  constructor(
    public readonly code:
      | 'TOO_SHORT'
      | 'TOO_LONG'
      | 'INVALID_CHARACTERS'
      | 'NON_ASCII'
      | 'LEADING_TRAILING_UNDERSCORE'
      | 'CONSECUTIVE_UNDERSCORES',
    message: string,
  ) {
    super(message);
    this.name = 'HandleNormalizationError';
  }
}

const HANDLE_MIN = 3;
const HANDLE_MAX = 30;
const ALLOWED_RE = /^[a-z0-9_]+$/;

/**
 * Normalizes a raw user-supplied handle to the canonical stored form.
 * Strips a leading '@' if present.
 * Throws HandleNormalizationError on any violation.
 */
export function normalizeHandle(raw: string): string {
  // Strip leading '@'
  const stripped = raw.startsWith('@') ? raw.slice(1) : raw;

  // Reject any non-ASCII codepoints (defense against Unicode confusable impersonation).
  // This catches Cyrillic а (U+0430) vs Latin a (U+0061), Greek ο vs o, etc.
  for (let i = 0; i < stripped.length; i++) {
    const cp = stripped.codePointAt(i)!;
    if (cp > 0x7e) {
      throw new HandleNormalizationError(
        'NON_ASCII',
        `Handle contains non-ASCII character at position ${i} (U+${cp.toString(16).toUpperCase().padStart(4, '0')}). ` +
        'Only ASCII letters, digits, and underscores are allowed.',
      );
    }
  }

  const lower = stripped.toLowerCase();

  if (lower.length < HANDLE_MIN) {
    throw new HandleNormalizationError('TOO_SHORT', `Handle must be at least ${HANDLE_MIN} characters.`);
  }
  if (lower.length > HANDLE_MAX) {
    throw new HandleNormalizationError('TOO_LONG', `Handle must be at most ${HANDLE_MAX} characters.`);
  }
  if (!ALLOWED_RE.test(lower)) {
    throw new HandleNormalizationError(
      'INVALID_CHARACTERS',
      'Handle may only contain lowercase letters (a-z), digits (0-9), and underscores (_).',
    );
  }
  if (lower.startsWith('_') || lower.endsWith('_')) {
    throw new HandleNormalizationError(
      'LEADING_TRAILING_UNDERSCORE',
      'Handle must not start or end with an underscore.',
    );
  }
  if (lower.includes('__')) {
    throw new HandleNormalizationError(
      'CONSECUTIVE_UNDERSCORES',
      'Handle must not contain consecutive underscores.',
    );
  }

  return lower;
}
