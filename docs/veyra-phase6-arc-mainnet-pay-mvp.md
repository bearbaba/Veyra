# Phase 6 — Veyra Arc Mainnet Pay MVP

**Release state: REVIEW BUILD — NOT AUTHORIZED FOR REAL-MONEY TRANSFERS.**
This is a standalone, self-custodial Arc Mainnet experiment. It does not
replace the current public Veyra website or its Arc Testnet Pay beta.

## Product rationale

The smallest useful onchain workflow is **Intent → Chain+Asset Verification →
Simulation → Human Review → Wallet Signature → Independent Receipt**.
We can prove this end-to-end without provisioning a server or PostgreSQL.
This is a narrow Mainnet canary, not the complete Veyra financial platform.

The app is intentionally modular:

- `src/mainnet/arcMainnetPay.ts` — fixed Arc chain 5042, USDC address,
  six-decimal ERC-20 transfer calldata, simulated balance+gas preflight,
  onchain receipt and canonical event verification
- `src/mainnet/arcMainnetJournal.ts` — fail-closed, chain/account-scoped
  client recovery lock; read-only reconciliations and no automatic retry
- `src/mainnet/MainnetApp.tsx` — English-first accessible isolated UI,
  EIP-6963/injected wallet discovery, manual chain selection and explicit
  consent. Does not import the production App, LLM, BFF or bridge modules
- `mainnet.html` and `src/mainnet/main.tsx` — separate Vite entry point
- `src/tests/phase6ArcMainnetPay.test.ts` — adversarial chain/amount/simulation,
  reserve, tamper, event receipt and journal regression suite

## Mandatory build isolation

The *existing* root `vercel.json` remains hard-pinned to **Testnet**.
Do not change this on the current Production Vercel project.

- **Safe Mainnet Preview (no signing)**:
  `VITE_VEYRA_ENV=mainnet VITE_VEYRA_MAINNET_MVP=1 VITE_VEYRA_MAINNET_PAY=0 bun run build`
- **Testnet Production-compatible Preview (unchanged)**:
  `VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1 VITE_VEYRA_TESTNET_PAY=1 bun run build`
- **Future Mainnet canary with real signing**:
  `VITE_VEYRA_ENV=mainnet VITE_VEYRA_MAINNET_MVP=1 VITE_VEYRA_MAINNET_PAY=1 bun run build`
  — **DO NOT RUN OR DEPLOY** until official Arc Mainnet network/USDC endpoint,
  human security review, wallet E2E in a controlled environment, wallet/domain
  phishing warning and release approval are recorded.

The CI pipeline builds both safe, independent entries, checks emitted assets,
and fails if signing is requested in a Testnet build. Shipping this new code
to GitHub never automatically enables real-money execution in Vercel.

## Chain, USDC and fee assumptions

- Arc chain ID: `5042`, separate from Arc Testnet `5042002`
- Arc native gas asset: USDC, **18-decimal RPC units**
- Arc USDC ERC-20 interface: `0x3600000000000000000000000000000000000000`,
  **6-decimal transfer units** (must be re-verified against live Mainnet)
- Arc Mainnet public JSON RPC: `https://rpc.mainnet.arc.io`,
  expected `eth_chainId=0x13b2` and successful `decimals()=6`
- Mainnet explorer: `https://explorer.arc.io`
- Only one user-signed `USDC.transfer(address,uint256)` with `value=0`
  and **maximum 1 USDC** per explicit approval; no arbitrary calldata.
- A single shared USDC balance covers both transfers and native gas;
  preflight checks balance >= transfer + a 2x estimated gas reserve.
  Native fee is converted to ERC-20 base units, rounded up.
- Simulation checks the exact `transfer` call, the token `decimals()`,
  estimated gas, RPC chain and wallet chain+account; the same checks repeat
  immediately before requesting a wallet signature.
- A transaction is called `VERIFIED` only after independent RPC checks of
  the exact `from/to/data/value`, receipt success, canonical block hash and
  matching six-decimal USDC Transfer log. Never infer success from wallet RPC.

## Important limitations before public usage

1. Browser-only localStorage recovery is **not atomic across browser tabs,
   devices or multiple operators**. Do not treat it as an enterprise-grade
   idempotency ledger. Unknown wallet outcomes must remain locked.
2. Browser public RPCs have availability, CORS, rate-limit and tampering
   risk. A production service should use independently controlled RPCs
   and cross-provider verification, observability and incident runbooks.
3. Fee preflight uses `eth_gasPrice`, `eth_estimateGas` and a safety buffer,
   not a guarantee that the wallet will quote or pay the same final fee.
4. This frontend is not a custodial service and has no integrated compliance
   screening, social identity resolution, fraud detection or BFF receipt store.
5. The public Arc documentation includes Testnet-specific pages even after
   the announced Mainnet launch; **verify production network and token
   metadata onchain and through Circle's up-to-date official channels**
   before any mainnet signing release.
6. Existing MetaMask domain warning must be resolved through the official
   review channel. Never ask users to bypass browser/phishing alerts.
7. An HTML build, green CI, deployed Vercel preview and mocked-wallet test
   are **not evidence of a real mainnet transaction**.

## Acceptance checklist (evidence required)

- [ ] Explicit confirmation of official Arc Mainnet RPC, chain ID, token
      address and ERC-20 decimals from live network responses
- [ ] Wallet connect, account+network change, malformed recipient,
      insufficient amount+gas and declined signature tested in a real browser
- [ ] No unexpected use of `eth_sendTransaction` in the safety-preview build
- [ ] Independent security review and MetaMask false-positive resolution
- [ ] Explicit operator approval and tiny controlled real-money canary
- [ ] Transaction hash, matching Arc Explorer receipt, exact USDC Transfer
      event, canonical block hash and fee evidence saved without secrets
- [ ] Reload/unknown-hash/cross-tab and cross-device duplicate-risk tested
- [ ] Decision recorded to enable only Mainnet Pay provider; Bridge/Convert
      remain off. Separate release approval and rollback ready.

## Expansion path

1. **Pay**: user-authorized fixed asset transfer + explorer proof.
2. **Veyra ID**: BFF and Postgres-backed signed wallet identity with
   recipient snapshot integrity, without changing the pay-review contract.
3. **AI Intent**: language recognition as untrusted user intent; deterministic
   typed plan and rules decide actual financial details.
4. **Bridge/FX**: existing CCTP recovery/provider systems are promoted only
   after separate E2E, source/destination settlement and replay tests.
5. **Activity**: server-backed, owner-authenticated, append-only receipts,
   cross-device state and idempotency.

## Source references

- Arc Mainnet announcement: https://www.arc.io/pressroom/circle-launches-arc-mainnet-an-economic-operating-system-for-the-internet
- Arc USDC native/6-decimal interface concepts:
  https://docs.arc.io/arc/references/contract-addresses
- Arc docs network reference: https://docs.arc.io/arc/references/connect-to-arc
- Existing release checklist: `docs/veyra-mainnet-release-gates.md`
