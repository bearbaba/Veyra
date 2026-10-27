# Chat backend release — Render baseline preservation

The release is based on Render's existing backend commit `c3be2e9a`, not on the divergent Vercel frontend feature branch.

## Preserved runtime boundaries
- The original `server/auth/browserRestoreSession.ts`, wallet login logic, Origin policy, payment recipient validation and receipts are unchanged.
- Chat routes have signed-session auth, latest connected-friend check and bidirectional block enforcement.
- Only ciphertext, random nonce and authentication tag are persisted. Encryption is server-managed, **NOT E2EE**.
- No Chat endpoint can sign a wallet transfer or create an incoming USDC notification.

## Release gates
1. CI including HTTP/PostgreSQL Chat acceptance must pass on this exact release branch.
2. Confirm migrations 0015 and 0016 against an isolated clone/snapshot of the Render Postgres schema before executing against any user data.
3. Provision a permanent random 256-bit key `VEYRA_CHAT_ENCRYPTION_KEY` only inside Render and keep a durable backup/rotation plan. Never reuse CI fixture keys.
4. Merge the vetted backend change to the precise Render source branch `phase5-production-bridge-flow`, with Auto Deploy off. A manual trigger is required after confirming SHA.
5. Verify F5 session restore, origin allowlist, Friends, payment review, encrypted Chat, notification and duplicate retry on a trusted V2 domain before promoting the frontend UI.
6. On any backend regression, revert the Render commit and redeploy the previous confirmed service image while keeping additive tables intact. Do not rotate keys in response to ordinary app failures.

## Explicit separation
This backend release does not activate X OAuth or Mainnet payment execution. The X state migration is additive and nullable; X continues gated pending independent provider configuration.
