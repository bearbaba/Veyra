# Phase 23 — CCTP source-chain simulation, approval and Preview trust gate

## Screenshot/defect
The Agent correctly imported 10 USDC Arc Testnet → Ethereum Sepolia, but Bridge always produced `Policy blocked: SIMULATION_REQUIRED`. Its pipeline had hardcoded `simulationCompleted:false` and `wasSimulated:false`, irrespective of route preflight. The screenshot also showed `Veyra ID blocked on this Preview`; this independently means authenticated CCTP Activity/Recovery cannot be relied on from that hostname.

## Implementation
- Both the signed deposit transaction and its preceding `eth_call` now use **one exact CCTP V2 depositForBurn call descriptor**. The RPC chain must be pinned Arc Testnet; source token and destination chains pinned to manifest. Check sender's USDC balance, exact amount allowance, and source TokenMessenger bytecode.
- A fresh **successful** source `simulateContract(depositForBurn)` produces short-lived evidence bound to actionId, wallet, amount, source/destination, recipient and token. The pure risk/policy pipeline accepts only that matching evidence, not a claimed provider health pass or model suggestion.
- If allowance is insufficient, Bridge shows **Approve exactly N USDC** as an independent reviewed wallet operation. The exact ERC-20 `approve` must first pass its own `eth_call`. Approval does not count as burn simulation. After receipt confirmation, a **fresh new route**, provider preflight and burn simulation are required before bridge initiation.
- The execution hook independently re-simulates `depositForBurn` **after approval and immediately before** the irreversible source submission/replay lock. RPC failure, insufficient balance, allowance changes, wrong wallet/chain or policy failure stop before any source burn.
- Static UI-only Preview, Mainnet builds, and unapproved Identity/BFF origins are blocked **before** authorization/approval. Preview is for review and education; a READY Vercel Preview is not permission to burn testnet funds.
- The existing destination attestation and crash-safe receipt/recovery logic is unchanged; no Mainnet or generic cross-chain provider newly enabled.

## Manual acceptance before release
Authorized Testnet BFF origin + real signed Veyra session; wallet with no allowance → explicit exact approval (no automatic burn) → fresh review → burn wallet signature → source receipt → Circle attestation → destination mint/recovery. Also test insufficient source USDC, wrong chain, changed account, contract revert, expired quote and Preview-origin block. Never ask a tester to approve a transaction merely because this PR's CI passed.
