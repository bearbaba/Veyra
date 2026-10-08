/**
 * Veyra Receipt ID generation
 *
 * All receipt IDs use the "veyra-" prefix.
 *
 * - Pre-execution plans: veyra-plan-<uuid>         (UUID-based, collision-resistant)
 * - Executed receipts:   veyra-<deterministic-hash> (derived from tx metadata when available)
 * - Fallback IDs:        veyra-<uuid>               (when tx metadata not yet available)
 *
 * Never use sequential numbers as canonical IDs.
 */

// ── UUID v4 ───────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random UUID v4.
 * Uses crypto.getRandomValues in the browser, or crypto.randomUUID when available.
 */
export function generateUUIDv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Polyfill for environments without randomUUID
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Node.js test environment fallback
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Set version (4) and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// ── ID Generators ─────────────────────────────────────────────────────────────

/** Generate a pre-execution plan receipt ID. */
export function generatePlanReceiptId(): string {
  return `veyra-plan-${generateUUIDv4()}`;
}

/**
 * Generate a deterministic execution receipt ID from transaction metadata.
 * Uses a simple hash of chainId + txHash to keep it collision-resistant.
 *
 * @param chainId  - Chain ID of the transaction
 * @param txHash   - Transaction hash (0x...)
 */
export function generateExecutionReceiptId(chainId: number, txHash: string): string {
  // FNV-1a 64-bit style hash over chainId + txHash
  const input = `${chainId}:${txHash.toLowerCase()}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;

  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, h2);
    h2 = Math.imul(h2 ^ c, 0x01000193);
  }

  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `veyra-${part1}${part2}`;
}

/**
 * Generate a fallback receipt ID for cases where tx metadata is not yet available.
 * Uses a UUID to avoid collisions.
 */
export function generateFallbackReceiptId(): string {
  return `veyra-${generateUUIDv4()}`;
}

// ── ID Validation ─────────────────────────────────────────────────────────────

/** Returns true if the ID looks like a valid Veyra receipt ID. */
export function isValidReceiptId(id: string): boolean {
  return /^veyra-/.test(id) && id.length > 7;
}

/** Returns true if the ID is a pre-execution plan ID. */
export function isPlanReceiptId(id: string): boolean {
  return id.startsWith('veyra-plan-');
}

/** Returns true if the ID is a deterministic execution ID (fixed hex length). */
export function isExecutionReceiptId(id: string): boolean {
  return /^veyra-[0-9a-f]{16}$/.test(id);
}
