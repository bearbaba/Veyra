# Unified Veyra Testnet — isolated deploy candidate

**Branch:** `phase9h-unified-testnet-host` (deploy-only). **Scope:** wallet UI, Social/ID/Notifications/Pay surfaces from reviewed full App. **Mainnet:** blocked.

The original financial project `veyra`, its production domains, `develop` and the isolated `veyra-identity-friends-beta` are not to be changed by this release.

1. Use a separate Vercel project named `veyra-unified-testnet` with deployment protection enabled. Deploy this exact branch; its `vercel.json` intentionally builds **full `index.html` + `src/main.tsx`** on Testnet only, unlike the immutable UI-only production preview branch.
2. The initial candidate has **no external BFF rewrite**. Wallet may connect and the UI may render, but signed social login and Pay-by-ID **MUST fail closed until the backend is explicitly connected**. Never report that the integrated app is live-ready just because Vercel says READY.
3. Review actual Render BFF deployment, database migration levels and CORS before enabling. The BFF already has a separately reviewed **one exact additional Testnet frontend origin** option. Configure `VEYRA_TESTNET_ADDITIONAL_ORIGIN` to the exact, stable, protected Vercel candidate HTTPS origin without path. Preserve the original Identity Beta primary origin and existing stored identities.
4. Only after the operator confirms the Render workspace, backend version, exact origins and negative-case acceptance, create a **reviewed allowlist of authenticated API rewrites** in this staging branch. Do not use `/api/:path*` wildcard or change the original financial project. Retest authorization, Origin preservation, missing backend, signed two-wallet identity session and Pay recipient snapshots before any payment prompt.
5. Exercise Wallet A → signed `@idA.veyra` → Friends → Pay friend `@idB.veyra` → fresh recipient review → user-approved small Arc Testnet USDC → independent receipt and Activity for both wallets; test wrong wallet/network, token expiration, cancellation, reload, BFF downtime and repeated click. Never mark financial test accepted without chain hash and exact log evidence.
6. Bridge/Swap remain separately gated. Unverified private messaging and X OAuth cannot be represented as live. The deployment must remain under protection until live E2E acceptance passes.

Vercel READY means static assets built; not Render connectivity or financial readiness.

## Exact Render integration accepted (23 Oct 2026)

Render Veyra Testnet BFF was deployed at code SHA `e4fc612`, with the exact secondary origin `https://veyra-unified-testnet.vercel.app` and its isolated PostgreSQL acceptance bootstrap. Only routes specified by `scripts/stagingBffAllowlist.ts` are forwarded from the protected Vercel Testnet project; no wildcard `/api/:path*`, no X OAuth route, no bridge execution route and no client-side API secrets. The exact allowlist is enforced by CI in the Testnet deploy branch. A successful Render deployment/migration and Vercel build do not substitute for two-real-wallet signed recipient/receipt acceptance. Social chat, X linking and Mainnet financial transfer remain not accepted.
