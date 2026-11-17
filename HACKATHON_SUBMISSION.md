# Veyra — Human-first USDC payments on Arc

**Arc Microgrants: Built with Arc Studio · Submission evidence kit**  
**Builder:** [bearbaba](https://github.com/bearbaba) · [X](https://x.com/Bearcrypto2021)  
**Live wallet-connect app (ONE site):** https://veyra-seven-beta.vercel.app/  
**Repository:** https://github.com/bearbaba/Veyra  
**Arc Studio project:** https://ibb9vwyygkkct5eupl9ay.preview.studio.arc.io

> **Submission status:** This file is a prepared package, not proof that a DoraHacks application was accepted. The publicly stated deadline was 2026-11-01; confirm the live form before submitting. This file does not certify an external audit, unreleased features, or an independently accepted two-user Veyra ID Pay/receipt E2E on the latest release candidate.

## Short description (copy into application)

Veyra turns Arc-native USDC into a payment experience built around people rather than transaction hashes. On Arc Mainnet, users can connect a self-custodial wallet, send USDC directly, and make contract-mediated payments through **VeyraSettlement**, a Solidity contract authored and tested using Arc Studio. The app presents a clear review-and-sign flow, then provides transaction evidence tied to Arc Explorer.

The broader Veyra architecture adds wallet-signed Veyra IDs, verified recipient discovery, Friends, private sender notes, and server-verified receipts. Those identity and cross-device receipt upgrades are currently on a reviewed development PR and **must not be represented as production-accepted until released and tested on the official site**.

Veyra is non-custodial: user-held wallets authorize every transfer. The settlement contract supports immediate payments with onchain references; that mode is **not buyer-protected escrow**. More advanced Swap, Bridge, Gateway, Agent, X and Chat experiences remain separately gated wherever mainnet end-to-end evidence is incomplete.

## Contract + example real-USDC Mainnet payment

| Evidence | Value |
|---|---|
| Chain | Arc Mainnet, chain ID 5042 |
| VeyraSettlement address | `0xfbec434fc2190f1887578b7a59b527d1b4acbe98` |
| Contract deployment tx | [`0xb5092b9...9e`](https://explorer.arc.io/tx/0xb5092b9269eb9bae4953372ab7fb44683fc14771a418805a7cb2776f6d8b92e9) |
| VeyraSettlement.pay() tx | [`0xf7ac133...31`](https://explorer.arc.io/tx/0xf7ac133ec0e4cac2a0342760e471c7debc7a3b97a9ad072e998ff4556b590731) |
| Contract payment reported | 0.01 USDC gross, 0 USDC contract fee, 0.01 USDC net |
| Contract source | [VeyraSettlement.sol](https://github.com/bearbaba/Veyra/blob/arc-studio/settlement-mainnet-preview/contracts/VeyraSettlement.sol) |
| Owner-supplied receipt evidence | [Mainnet canary record](docs/arc-mainnet-settlement-canary-success.md) |
| Alternate direct USDC Mainnet tx | [`0x5bc290...6a06`](https://explorer.arc.io/tx/0x5bc290fea0e159f936c7d09f1141af074a38db6b31f5e0f3336a47cfd2860a06) |

**Evidence scope:** Owner-provided app and Arc Explorer screenshots, recorded on 2026-11-01, showed a successful onchain `pay()` call and two USDC transfers: sender → contract → recipient. The cited screenshots are not a substitute for independent raw-log decoding or security auditing. Reviewers can follow the public explorer links.

## Why Arc and Arc Studio matter

- Arc Mainnet settles transactions using USDC and supports EVM Solidity contracts. VeyraSettlement moves **real USDC**, emits contract evidence and is integrated in the production web app.
- Arc Studio was used to author the contract, run internal security review, integrate the app, and prepare release evidence.
- Solidity unit, fuzz, and invariant tests are in `contracts/test/VeyraSettlement.*.t.sol`, with an existing recorded 60/60 Foundry pass. Re-run on the exact current contract commit for up-to-date proof.
- Readiness, activity tracking and fail-closed signing are implemented in source; new backend People/receipt improvements pass independent CI but are not substitutes for Mainnet E2E.
- Financial source/recipient/amount and verified receipts remain distinct from cosmetic UI success messages.

## Short video storyboard (~3–5 minutes)

1. **0:00–0:30** — Introduce Veyra as one USDC payment app. Show the sole official wallet website and the human-first problem.
2. **0:30–1:10** — Show Arc Studio project, `contracts/VeyraSettlement.sol`, unit/fuzz/invariant tests and source version. Use original chronological build footage, not simulated clips.
3. **1:10–1:45** — Show Arc Mainnet contract address and actual deployment transaction in Explorer.
4. **1:45–2:45** — Show the existing **successful** original `pay()` transaction and Veyra receipt side-by-side. If live transfer is repeated, use an owner-controlled small amount and independently verify the exact new transaction; otherwise explicitly call it a recorded transaction, not a new live transfer.
5. **2:45–3:30** — Explain identity, planned People → Pay → Receipt experience. Only show it as live if it has been deployed and signed-session tested on the official site. Do not claim X Tip/Gateway/Bridge E2E without receipts.
6. **3:30–4:00** — Finish with the production app URL, repository, Arc Studio link and public explorer proof.

## Reviewer instructions

Open the **official live app**, then Arc Explorer payment transaction above, and compare the contract, transfer amount and event details with the public source. The development PR for People/Pay/Activity is [PR #91](https://github.com/bearbaba/Veyra/pull/91) and its upstream safety/UX PRs are #87 and #90. An independently reproduced new two-wallet Mainnet Veyra-ID payment is **not** yet part of this evidence.

## Production and security boundaries

- Production canary evidence is real Mainnet according to owner screenshots, but has **not** been independently decoded by this package's author.
- The identity-and-receipt BFF and isolated PostgreSQL are live as infrastructure; the front-end integration is still under staged PR/production safety gates.
- A single official wallet website is mandatory. Do **not** request wallet connection or signatures on Arc Studio, Vercel Preview or Render backend hosts.
- No mainnet finance write should be enabled solely from passing Vitest, typecheck, lint and build.
- Never publish credentials, private notes, auth tokens or database connection URLs in a hackathon application.

## Submission checklist

- [x] Public repository and contract code
- [x] Arc Studio project URL documented
- [x] Mainnet contract address and owner-supplied deployment evidence
- [x] Mainnet 0.01 USDC contract payment evidence and public explorer link
- [x] Official production app URL
- [ ] Verify live DoraHacks submission form is still accepting entries after stated November 1 close
- [ ] Attach the original chronological Arc Studio build and transaction walkthrough video
- [ ] Confirm current production UI functionality on the official domain and record final browser acceptance evidence
- [ ] Distinguish the existing successful contract payment from the unreleased Veyra ID two-user receipt journey
