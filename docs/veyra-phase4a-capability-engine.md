# Veyra Phase 4A — Capability Engine + Intent Graph + UX-aware Routing

Phase 4A begins Veyra vNext without bypassing the existing deterministic execution core.

## Product direction

Veyra remains intentionally simple at the surface: **Home / Pay / Agent / Activity**.
Underneath, the Agent can understand and plan Pay, Unified, Bridge, Swap, Earn, Onramp, Identity and Reserve intents.

Arc is Veyra's home network, not its boundary. Product-level network references are not restricted to numeric EVM chain IDs, so future EVM, Solana and other independently supported networks can enter the same routing model.

## New hard UX invariants

1. **Veyra adds zero wallet signatures.** Review, policy, risk and receipts are offchain app state and never create a signing step.
2. **Minimize protocol signatures.** A route that saves a few cents must not win by forcing unnecessary wallet signatures.
3. **Minimize manual network switching.** Read/context can be multi-network regardless of the wallet's selected network; routing prefers provider flows that abstract destination switching.
4. **Fail closed.** A recognized capability or network is not executable until provider lifecycle, runtime health, policy, risk and preflight allow it.
5. **Explain money movement.** Bridge, Unified, Swap, Earn and Onramp require an understandable explanation before signing.

## Added

- Product `CapabilityRegistry` for PAY / UNIFIED / BRIDGE / SWAP / EARN / ONRAMP / IDENTITY / RESERVE.
- Provider capability vocabulary for App Kit-era capabilities while preserving lifecycle gating.
- Deterministic local `CapabilityIntentGraph` for multi-clause goals such as:
  - `Keep 300 USDC on Arc, send @bearcrypto2021 50 USDC, bridge 200 USDC to Arbitrum, then earn the rest.`
- Chain-family-neutral product `NetworkRef` model.
- `UniversalMoneyRouter` scoring user burden explicitly: wallet signatures, manual network switches, extra confirmations, risk, fees and ETA.
- Deterministic tie-breaking and rejected-route reporting.
- Tests enforcing the zero-Veyra-signature invariant and routing determinism.

## Important boundary

This phase does **not** automatically enable new financial providers. Unified, Swap, Earn and Onramp remain gated until current official integration details are independently verified and their adapters pass the mandatory lifecycle:

`DISCOVERED → VERIFIED → IMPLEMENTED → TESTED → ENABLED`

The existing execution pipelines remain authoritative for money movement.
