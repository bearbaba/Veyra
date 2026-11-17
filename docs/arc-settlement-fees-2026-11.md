# Arc settlement pricing — Veyra integration review (2026-11-17)

**Scope:** explain Arc's 2026-11-16 fee announcement in existing Mainnet review screens. Not a route activation, fee override, autonomous bridge or financial audit.

## Primary sources

- Arc: [Build Settlement on Arc With Reduced Crosschain Fees](https://www.arc.io/blog/build-settlement-on-arc-with-reduced-crosschain-fees), published 2026-11-16.
- Circle: [Current crosschain pricing and supported routes](https://developers.circle.com/crosschain-fees). Consult at quote time; policies and availability can change.

## What the announcement supports

| Mechanism | Published Arc-side pricing | Veyra support boundary |
| --- | --- | --- |
| CCTP Standard, USDC | No CCTP Standard transfer service fee | Veyra's existing reviewed USDC Bridge candidates request `transferSpeed:'SLOW'`; dynamic SDK quote, forwarding and gas still apply |
| CCTP Fast into Arc | 75% lower Fast Transfer fee | Informational only; Veyra does **not** automatically enable Fast or claim savings in a live quote |
| CCTP Standard EURC / cirBTC to/from Arc | Standard service-fee waivers reported | **Not** new Veyra Bridge capabilities; require independently validated asset/route support |
| Gateway on Arc | Arc-side Gateway service fees waived on supported assets | Current Veyra Gateway uses USDC only and can read a wider ledger than it can sign from. Never treat a pooled balance or waived fee as a spending authorization |

**Fees that may remain:** origin gas (USDC on Arc, ETH on Ethereum/Base), destination forwarding, wallet approval or other provider/route charges. Provider estimates and final receipts—not press-release percentages—control what Veyra presents as live total and verified settlement.

## Required safety properties

1. Financial review must continue to bind exact source chain, destination, USDC token contract, owner, recipient, quote timestamp, minimum received and itemized provider fees.
2. CCTP `maxFee` cannot rise above the user's reviewed cap without another user review. Live estimates must fail closed if absent or stale.
3. A Gateway ledger can contain confirmed assets on 12 EVM networks while Veyra currently authorizes source signing only on Arc/Base/Ethereum. Neither the headline balance nor a discount widens that allowlist.
4. Quote generation must not switch wallets, sign, approve or trigger a transfer. No automatic retry for ambiguous outcomes.
5. An Arc Standard waiver does **not** mean a $0 total charge. Explicitly name USDC as Arc source gas and ETH on Base/Ethereum.
6. Arc Fast is not integrated by this change. Any future Fast option needs quote schema support, current price verification, reviewed fee caps, receipt proof and dedicated E2E validation.

## Work still required for a full 9.5/10 release

- **P0 — Live acceptance:** reproducible real Mainnet receipts for Pay, Gateway deposit/spend and CCTP Bridge on each *enabled* route, including wrong-chain, insufficient-gas and duplicate-lock scenarios; no real transaction in automated CI.
- **P0 — Cost preview:** when the SDK permits, present a *fresh, comparable* user-cost estimate (source gas + provider/forwarder costs + amount received) per available route. Never synthesize rates from a marketing discount.
- **P0 — Production evidence:** track code SHA, Vercel deployment SHA, target branch, BFF health and route capabilities in one operator checklist; publish only after green CI and rollback readiness.
- **P1 — Unified money UX:** separate wallet-held balances, Gateway confirmed/pending balance, and actually spendable source allocation. Keep `Add`, `Send`, and `Pay` as distinct actions with proper receipt handoff.
- **P1 — Reliability/security:** external security review, backend retention and recovery drill, signed wallet/session binding, rate limiting, cross-device operation locks, no replay and monitorable post-release errors.
- **P2 — More assets/routes:** EURC, cirBTC and Fast only after public availability, contract and wallet compatibility, fresh fees and real source/destination proofs are confirmed.

## Files included in this incremental change

- `src/mainnet/arcSettlementFeeDisclosure.ts` — **informational** fee policy helper
- `src/components/pages/MainnetCirclePage.tsx` — Bridge Standard context and correct Arc USDC gas guidance
- `src/components/pages/MainnetUnifiedBalancePanel.tsx` — Arc-side Gateway context in Add/Send review
- `src/tests/arcSettlementFeeDisclosure.test.ts` — no fake discounts, wrong-asset support, or gasless assumptions

This change intentionally leaves signing gates, CCTP and Gateway SDK execution paths, onchain contracts, backend and Production settings unchanged.
