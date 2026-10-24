# Veyra unified website — Production release decision

**Status: READY FOR A CONTROLLED WEB RELEASE REVIEW, NOT APPROVED FOR
REAL-MONEY MAINNET EXECUTION.**

The only intended public URL remains
`https://veyra-seven-beta.vercel.app`. The Production deployment is
associated with GitHub branch `develop`. The reviewed unified
Testnet/Mainnet candidate is on `phase5-production-bridge-flow`.

## What the release would ship

- **One website, one sidebar network selector, Testnet selected by default.**
- Testnet: wallet-approved direct Arc Testnet USDC Pay with an existing 1-USDC
  cap, separate wallet approval, independent receipt verification and
  conservative recovery lock. Bridge and Convert remain non-executing.
- Mainnet: public balance reads and capped **simulation only**. No
  `eth_sendTransaction` or actual USDC transfer in its imported public UI.
  Mainnet Pay, Convert, Bridge, identity and external execution remain locked.
- The informational AI Agent uses the existing protected, server-side
  Vercel API if configured; do not promise live AI if no credentials exist.
- No production Postgres or Express BFF is deployed by this web release.
- Response headers prevent clickjacking and unwanted browser capability
  grants, without introducing an untested strict CSP that could break wallets.

## Automated release invariants

Run `bun run scripts/check-unified-production-release.ts` in addition to
the standard typecheck, lint, tests, Vite build, Testnet bundle isolation,
Mainnet safe-preview isolation, Docker safety and no-API-rewrite checks.
The release guard fails if:

1. The public Vercel build is not explicitly
   `VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1 VITE_VEYRA_TESTNET_PAY=1`.
2. The unified selector no longer defaults to Testnet or the Mainnet screen
   imports the standalone signer.
3. The Mainnet page contains wallet-signing / chain-switching / bridge methods
   or Mainnet providers are accidentally enabled.
4. Broad backend rewrite rules or exposed financial environment variables
   appear in `vercel.json`.
5. Essential web headers are removed.

**A passing CI is a necessary gate, not sufficient proof** of correct
cross-browser UX, network RPC uptime, RPC authenticity, finality or wallet
reliability.

## Mandatory manual and external evidence before promotion

- [ ] Confirm `develop` Production is still at its known commit, has a
      rollback candidate, and PR #7 is mergeable at the reviewed Phase 5 SHA.
- [ ] Browser test the **actual protected Preview** on desktop and mobile;
      EIP-6963 wallet connection, Testnet default, switch to Mainnet and
      back, cross-network form reset and explicit manual wallet-chain switch.
- [ ] On a trustworthy public Arc Mainnet RPC, confirm
      `eth_chainId=0x13b2`, USDC address
      `0x3600000000000000000000000000000000000000`, `decimals()=6`,
      and real balance/simulation against an approved test address.
- [ ] Confirm the browser built assets and network payloads contain no
      Mainnet `eth_sendTransaction`, wallet signing, CCTP burn or relaying.
- [ ] Validate mobile menu, keyboard access, layout and Agent's network
      hints. AI server availability is a separate beta gate.
- [ ] Resolve the known MetaMask/domain security warning via MetaMask's
      official manual review process. Do not tell users to disable
      phishing protection or ignore wallet warnings.
- [ ] Record evidence (screenshots without secrets, build hash, CI links,
      Vercel deployment ID), named reviewer and rollback instructions.
- [ ] Only then merge PR #7 `phase5-production-bridge-flow` → `develop`
      and confirm the new **Production** deployment is READY on
      `veyra-seven-beta.vercel.app`.
- [ ] Run browser smoke tests again on the canonical Production hostname,
      verify access controls and no accidental Mainnet execution.

## Domain false-positive review

MetaMask documents the **manual review path for URL classifications** via
its support team:
https://support.metamask.io/configure/wallet/security-alerts

Send the exact flagged domain, a screenshot of the wallet warning, Arc
Testnet/Mainnet supported network details, public source code, explanation
of the 1-USDC Testnet cap, explicit wallet signature, locked Mainnet Pay,
and details of independent onchain receipt verification. Do not claim
MetaMask has cleared the site without a confirmed decision.

## Future Mainnet financial activation

Mainnet Pay `enabled: false` is deliberate. Real USDC authorization requires
a **separate** release plan, financial acceptance, controlled canary,
cross-device idempotency, independently observed settlement and signed
operator decision. The single website architecture does not permit
bypassing those checks merely by selecting a Mainnet tab.

Other checklists:
- `docs/veyra-mainnet-release-gates.md`
- `docs/veyra-unified-network-workspace.md`
- `docs/veyra-hosted-testnet-deployment.md`
