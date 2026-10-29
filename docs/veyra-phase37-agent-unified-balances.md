# Phase 37 — Agent Unified USDC snapshots (read-only)

- Agent → Unified reads the connected wallet's pinned USDC ERC-20 `balanceOf` on Arc Testnet, Ethereum Sepolia and Base Sepolia independently. No wallet signing, approval, deposit, swap, on-chain write, backend migration or mainnet activation.
- Each RPC validates chain ID and source token contract bytecode before balance read. A failed RPC produces an explicit Unavailable state, never a fabricated 0. Exact bigint precision and 6 decimals; no Number math.
- A display-only combined total is shown ONLY if all three independently verified balances exist. It is NOT spendable in one transaction, and is not a bridge quote or routing authorization. The Arc native-USDC gas balance is not double-counted.
- On wallet change/disconnection, stale results are hidden by owner scope, with asynchronous results invalidated; foreground refresh and manual Refresh provide read timestamp.
- Phase 36 reverse UI clarity: when allowance is missing, the heading now explicitly says Reverse Bridge unavailable. No request to approve is offered.
- Release gates: phase37 tests + full CI, desktop/mobile check and an exact-commit READY Vercel Preview. Do not promote the current stable Testnet V2 alias until signed-wallet browser acceptance. No Render/Mainnet writes.
