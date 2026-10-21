# Phase 8H — isolated Veyra ID & Friends browser acceptance

**Status:** source and CI acceptance only until dedicated Vercel beta + two real browser wallets pass. Main Vercel Preview remains unchanged. No financial execution is enabled.

## Exactly what this builds

A new, **separately compiled** entrypoint `identity-beta.html` with an English UI for:

1. Connect an injected EIP-1193 EVM wallet **without** network auto-switching
2. Register a new Veyra ID using the owner's Arc Testnet EIP-712 claim
3. Re-login to an existing ID with the new purpose-bound, five-minute one-use EIP-712 challenge
4. View own PostgreSQL-backed friend list, send an invitation by the other person's Veyra User ID, accept/reject an invitation, and block/unblock
5. Keep Bearer token **in browser memory only** (no localStorage/sessionStorage); reload/account or chain switch requires re-login

UI **never** invokes `eth_sendTransaction`, `personal_sign`, `wallet_switchEthereumChain`, Bridge, Swap, Pay-by-ID, funding or token approvals. Its only signature RPC is `eth_signTypedData_v4`. The app validates every EIP-712 field: domain, signature purpose, chain 5042002, wallet address, nonce, expiry, verification contract, login origin, and schema.

The existing `vercel.json` deliberately remains the old production-preview build. This beta does not silently replace it.

## Local verification

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
VITE_VEYRA_ENV=testnet VITE_VEYRA_IDENTITY_BETA=1 bun run build
bun run scripts/check-identity-beta-bundle.ts
```

This build produces `dist/index.html` from `identity-beta.html` **only**. The GitHub CI additionally rejects mixing `VITE_VEYRA_IDENTITY_BETA=1` with existing financial preview flags.

## Deployment prerequisites — STOP if any fails

1. Use a **separate** Vercel project/branch, not Veyra's existing Production/Preview project. Build command: `VITE_VEYRA_ENV=testnet VITE_VEYRA_IDENTITY_BETA=1 bun run build`; use the matching standalone isolated `vercel.json` on that hosting branch. Disable automatic production promotions.
2. Confirm the intended stable HTTPS beta origin (no preview-generated rotating hostname). Render BFF CORS uses a **single exact `VEYRA_APP_ORIGIN`**; do not allow wildcard, and do not expose keys or URLs with credentials.
3. Before changing `VEYRA_APP_ORIGIN`, verify that the old pilot origin is no longer the active authenticated app. Rotating it will deliberately revoke its browser CORS access. Document this as a controlled cutover and review rollback.
4. Change Render `VEYRA_APP_ORIGIN` to the exact stable beta HTTPS origin **only after** the new beta is deployed and validated as isolated. Use a **non-financial, test-only** backend. Re-deploy Render and verify CORS 204 for the beta origin, 403 for a hostile origin, 401 for anonymous `GET /api/social/friends`, and `/api/health/database` PASS.
5. Use two disposable zero-value browser wallets on Arc Testnet. First register two new IDs, then reload and sign in again. Exchange user IDs and request/accept friends; test block/unblock and that a fresh request is required after unblock. Ensure no wallet transaction signature is requested.
6. Capture screenshots and redacted request IDs, without addresses, signatures, Bearer tokens, seed phrases, Render secrets or private DB URLs. Any failure is a **FAIL**, not a PASS by assumption.

## Intentional limitations

- Exactly one injected `window.ethereum` provider is selected; use separate browser profiles for two wallets in manual acceptance. EIP-6963 wallet choice is a later enhancement.
- No wallet session renewal without a fresh wallet signature after reload.
- No identity lookup by handle or public friend search; current invite uses immutable Veyra User ID.
- Render Free may sleep when idle; first request can take longer. PostgreSQL Free expires on 2026-11-20 and has no backups. This environment must not hold real user data or become Production.
- CI's two EIP-712 wallets are **generated and unfunded inside CI**, not a replacement for the user-controlled browser acceptance.
- `financialAcceptanceReady: false` remains unchanged.

## Release decision

Do not label the pilot live until **separate project + exact HTTPS Origin + two wallet browser proof** all PASS. No Mainnet or financial rollout from this PR.
