# Veyra Unified Network Workspace — one domain, two isolated environments

## Decision

**One Veyra web app, not two competing public websites.** A compact switch in
the left sidebar toggles **Testnet** and **Mainnet**. The default is Testnet
on every page load. Switching contexts resets the current page to Overview,
clears unsigned Mainnet review state and does not invoke any wallet
add/switch-chain method. The same injected EIP-1193 wallet connection can be
observed in both contexts, but public reads and future execution are strongly
network-separated.

## Current runtime behavior

| Item | Testnet | Mainnet |
| --- | --- | --- |
| Chain | Arc Testnet `5042002` | Arc Mainnet `5042` |
| Wallet | EIP-1193 injected | Same connection; user must select correct chain |
| Balance | Existing pinned Testnet USDC | Fixed Arc RPC + canonical 6-decimal USDC interface |
| Pay | Existing wallet-approved 1-testnet-USDC direct Pay | **Read-only** quote/simulation up to 1 real USDC |
| AI Agent | Existing protected informational Vercel endpoint | Same non-executing Q&A endpoint with network-aware UI |
| Bridge / Convert | Gated | Gated; no mainnet execution |
| Activity | Browser-local Testnet receipt journal | Public explorer link only; no fabricated server receipts |
| Signing | Testnet only, via original narrow authorized module | **Not bundled** from mainnet signing module |

Mainnet observation/simulation validates the pinned `eth_chainId`, USDC
`decimals()=6`, recipient and amount, exact `transfer` calldata, `eth_call`
simulation, gas estimate and a **2×** native fee reserve converted from
18-decimal gas units to 6-decimal USDC units. Public RPC success does not imply
real settlement. No payment signature RPC is present on Mainnet surfaces.

Both modes show a persistent environment ribbon and label, with Mainnet
clearly marked **READ ONLY**. Switching environments never silently changes
wallet network or opens a wallet approval.

## Implementation boundaries

- `src/preview/PreviewApp.tsx`: application-level switch and conditional
  environment surfaces; Testnet payment page is left intact.
- `src/preview/arcMainnetReadOnly.ts`: standalone, **non-signing** onchain
  observation layer. It never imports `src/mainnet/arcMainnetPay.ts`.
- `src/preview/PreviewMainnetSurfaces.tsx`: Mainnet Overview, Pay simulation,
  explicitly unavailable Bridge, Convert, Activity and Settings.
- `src/preview/PreviewLiveAgent.tsx`: network-aware guidance, informational
  only. User language may vary; UI defaults to English.
- `src/preview/preview.css`: responsive sidebar control styling.
- `src/tests/phase6UnifiedNetworkWorkspace.test.ts`: source boundary and
  adversarial RPC / amount / decimals / gas / provider-output verification.
- Existing `scripts/check-vercel-preview-bundle.ts` continues to enforce
  a single **Testnet-only** wallet financial submission path and prohibits
  importing the Mainnet signing provider.

## Deployment

The existing `vercel.json` build is deliberately unchanged:

`VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1 VITE_VEYRA_TESTNET_PAY=1 bun run build`

This build now renders the **unified workspace shell**. The `testnet`
environment variable controls the **only executable financial action** in
this release, not which menu options are visible.

The earlier Phase 6 standalone Mainnet `mainnet.html` and signing-capable
module are retained for future audited release work but are **not imported by
the shared public Vercel Preview**. They cannot be enabled by clicking the
Mainnet tab.

## Staged Mainnet launch and expansion path

1. Keep the Mainnet page read-only. Independently verify live RPC behavior
   and browser CORS, wallet chain labels and simulation responses.
2. Resolve the MetaMask/domain warning via the official review process.
3. Audit the exact transaction execution module, onchain finality, cross-tab
   and cross-device idempotency. Standalone localStorage is not a production
   deduplication service.
4. Introduce a separate, explicit, reviewed Mainnet Pay activation gate on
   the unified web **only after** independent security sign-off, a small-value
   operator-approved canary and verified chain receipt. Do not simply flip
   `VITE_VEYRA_MAINNET_PAY=1` on the existing Vercel project.
5. Add Veyra ID/Agent orchestration through the authenticated BFF and managed
   PostgreSQL; keep public read-only routing independent of backend uptime.
6. Promote Bridge, Convert and cross-device Activity individually, using
   verified provider health, durable receipts and comprehensive E2E evidence.

**Status:** unified Testnet/Mainnet UI is a release candidate only until
staging CI, browser verification and domain review are complete. It is not
permission to execute a mainnet transaction.
