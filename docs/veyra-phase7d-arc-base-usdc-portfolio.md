# Phase 7D — Real native USDC reads on Arc + Base

**Product goal:** make the existing Unified tab useful with multiple verified
public USDC balances while retaining its uncomplicated Veyra interface.
This is not a Circle Gateway deposit, wallet transfer or financial quote.

## Scope actually implemented

- Testnet Unified: existing Arc Testnet USDC live read and **Base Sepolia**
  native USDC read via `https://sepolia.base.org` (chain 84532).
- Mainnet Unified: existing Arc Mainnet USDC live read and **Base Mainnet**
  native USDC read via `https://mainnet.base.org` (chain 8453).
- Base token address (Circle USDC only):
  - Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
  - Mainnet `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Validates user EVM address, RPC chain ID, positive block number,
  non-empty pinned-contract bytecode, exactly **6** ERC-20 decimals and
  strict hex from `balanceOf()`. A public read does not require the user's
  active wallet to switch chains.
- If a public RPC is down, slow, rate-limited, on the wrong chain or returns
  unexpected data, show **Unavailable**; never substitute `0` or stale
  amounts. Wallet/network switches abort old observations.
- No combined USD total, synthetic prices, deposits, signatures or extra
  token additions. Remaining chains in the product registry are **Catalog
  only**, not presumed funded or supported for execution.

## Official sources

- Circle native Base USDC versus **non-Circle bridged USDbC**:
  https://www.circle.com/blog/usdc-now-available-natively-on-base
- Circle mainnet & testnet address registry:
  https://developers.circle.com/stablecoins/usdc-contract-addresses
- Base public RPC and chain identity:
  https://basehub.org/api-reference/rpc-overview/
  https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_chainId
- Existing pinned Arc & Base addresses:
  `src/config/mainnetCatalog.ts`, `src/onchain-facts`.

## Acceptance and risk boundaries

- Vitest fails on mismatched RPC chain, malformed hex, missing code, decimals
  other than 6, wrong token, 429/500, bad response ID or unknown address.
- Chromium desktop accepts Unified Testnet/Mainnet balance display with
  deterministic intercepted RPC replies; mobile checks no overflow.
- Separate Chromium live endpoint acceptance probes public Mainnet **and**
  Sepolia RPC origins without a real wallet or funds. Production gate fails
  if either is unreachable. This is still **NOT** live-wallet or real-money
  acceptance.
- Public Base endpoints are explicitly **rate-limited** and not supported
  as production-traffic infrastructure. Prior to a large user launch,
  replace with independently audited provider RPC endpoints or a
  privacy-preserving, rate-limited service with monitored uptime. Do not
  send wallet addresses to unknown or user-supplied RPC URLs.
- Circle Gateway Unified Balance is a distinct opt-in pooled-balance product.
  No Gateway `deposit()`, `spend()`, signing or approval in these files.
- Mainnet Pay/Bridge/Swap remain disabled in the public Testnet-first UI;
  Veyra ID friends/Pay-by-ID remain backend/PostgreSQL gated.

## Next work

1. Run human UX checks in a clean browser after MetaMask URL safety review.
2. Review chain RPC reliability; extend onchain USDC to another verified EVM
   network one chain at a time, not by turning all catalog entries into
   pretend balances.
3. Complete verified Veyra ID creation, friend request, recipient snapshot
   and capped Testnet Pay-by-ID with a deployed authenticated backend.
4. Only after that accept full financial Bridge and Swap workflows.

**Production:** this PR targets the protected Phase 5 Preview branch, not
`develop` or a real-money Mainnet release.
