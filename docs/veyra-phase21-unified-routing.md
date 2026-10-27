# Phase 21 — Unified Payments: precise Sepolia destination and CCTP route handoff

User acceptance screenshot: "gửi cho 0xEE8f… 2 usdc qua sepolia giúp tôi" incorrectly displayed **Ready to review** without a destination and navigated to Arc direct Pay.

## Implemented
- Deterministic Sepolia parsing: bare **Sepolia** is ambiguous (Ethereum Sepolia vs Base Sepolia); card offers both choices preserving amount and EVM recipient. Selecting one prepares the exact follow-up text; it does not sign.
- Explicit **Ethereum Sepolia** and **Base Sepolia** destination requests with recipient+amount+USDC and Arc Testnet source now map to **BRIDGE**, not **TRANSFER**.
- Route CTA checks pinned CCTP V2 manifest lifecycle, Arc source, target chain, exact positive 6-decimal amount and valid EVM recipient. It forwards the draft through existing Agent handoff to Bridge.
- Bridge revalidates the draft before prefill, and its existing route engine performs fresh CCTP provider preflight, policy/risk checks, burn/attestation/receive verification and user-wallet approval. Nothing automatically signs or executes.
- Hosted model suggestions cannot replace an explicit Sepolia request with direct Arc Pay.

## Honest availability
This is NOT universal cross-chain spend or native USDC payments on every network. Current executable testnet routes are direct Arc Testnet USDC transfers and lifecycle-enabled CCTP V2 Arc Testnet -> Ethereum Sepolia / Base Sepolia. Base Mainnet, Ethereum Mainnet, reverse bridge, arbitrary networks, and Veyra-ID-to-destination identity resolution remain locked.

When source is not stated, the only supported Arc source is **explicitly displayed**, not silently treated as assets already held. Wallet must have enough Arc Testnet USDC; Bridge route preflight is the execution authority.

## Acceptance
Run Vietnamese address-first 2 USDC to bare Sepolia (choice required), explicit Ethereum Sepolia and Base Sepolia (Bridge prefill, no signing until manual review), non-Arc source, invalid recipient, zero USDC, wallet change, reload, RPC outage, and CCTP pending recovery. No production release without real-wallet tests.
