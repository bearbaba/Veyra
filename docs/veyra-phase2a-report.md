# Veyra Phase 2A — Identity + Wallet Proof

Baseline: `develop` at `68a8bd6`.

## Implemented

- Added `proof_challenges` as the authoritative single-use wallet proof challenge store.
- EIP-712 is the default proof scheme; `personal_sign` is an explicit fallback.
- Challenges bind `veyraUserId`, wallet address, chain ID, random 32-byte nonce, issue time and expiry.
- Challenge verification reconstructs and hashes the canonical payload before signature recovery.
- Challenge consumption and `wallet_bindings` insertion happen in one database transaction.
- Replays, expiry, owner mismatch, wallet mismatch and cross-user active wallet conflicts fail closed.
- Added `/api/identity/challenge` and `/api/identity/verify-wallet`.
- Added identity snapshot freeze/verify services and `/api/identity/snapshot`, `/api/identity/verify-snapshot`.
- Snapshot verification checks TTL, identity revision and the frozen wallet set before confirm.
- Added Phase 2A migration and migration-from-zero coverage.

## Production auth boundary

The project still has no production session/OAuth implementation. Identity endpoints therefore do **not** trust a client-supplied `veyraUserId` in production. `X-Veyra-User-Id` is accepted only when `NODE_ENV !== 'production'` for local development. Production requests receive `401 AUTH_REQUIRED` until the real Veyra session layer is implemented.

This is deliberate: a wallet signature proves ownership of the wallet, but by itself does not prove authority over an arbitrary Veyra identity.

## Next checkpoint

1. Add production Veyra session/authentication and X OAuth account linking.
2. Implement `ProfileService` and complete recipient resolver API wiring.
3. Wire Pay + Agent review sheets to `freezeSnapshot()` / `verifySnapshot()`.
4. Add full DB-backed E2E tests for challenge → sign → verify → wallet binding and replay rejection.
