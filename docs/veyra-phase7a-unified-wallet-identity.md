# Phase 7A — Wallet, Token & Network Identity

## Product direction

Keep Veyra's current layout, dark surfaces, typography and Testnet/Mainnet
switch. Upgrade the clarity and truthfulness of what users see; **do not**
claim that listing a coin means its balance, swap route, CCTP destination or
fiat value is supported.

This is the first incremental step toward an actual Unified portfolio.

## Shipped in this PR

- **Unified** menu page on both environments, with searchable **Assets** and
  **Networks** tabs. Product metadata is derived from
  `src/config/productRegistry.ts` rather than duplicated UI lists.
- The first and only verified live balance reader in Unified is **Arc USDC**:
  Arc Testnet `5042002` or Arc Mainnet `5042` via pinned public RPC, never
  an inferred cross-chain balance. Every other asset and chain is explicitly
  **Catalog only**.
- Discovery is separate from execution. Browser-visible asset badges have
  **no impact** on Provider Manifest, Bridge, Swap, Convert, signing or
  Mainnet lifecycle flags. The unified screen never imports financial
  execution modules.
- EIP-6963 wallet images can display via small, inline data URIs supplied by
  the detected extension, constrained to image formats and a 100 KB cap.
  Remote icon URLs and script URLs are rejected. Any unavailable/broken icon
  falls back to a visually distinct two-letter provider mark; no broken image.
- Installed wallet choices are stable-sorted (popular EVM providers first),
  condensed to four entries, searchable and expandable. Permission rejection
  now leaves the wallet dialog open so users can see the error.
- On the Testnet Overview, the old A/Ξ/B placeholder route circles become
  actual existing BrandLogo graphics and the details link navigates to Unified.
- Retains English-first UI and the multilingual informational Agent.

## Scope boundaries / limitations

1. **Do not present a total portfolio USD figure.** EURC, ETH, WETH, WBTC,
   USDT, DAI, cirBTC and USYC are metadata-only here; no invented balance
   or trusted price feed. Listed external networks are not connected accounts.
2. Wallet icon identity is not the same as a verified wallet signing policy:
   extensions and the browser remain an external trust boundary. Embedded
   logos are visual hints only, never security signals or execution authority.
3. Remote Circle logo URLs in the preexisting BrandLogo component retain
   deterministic local fallback marks; final production-grade icon asset
   licensing and bundling can be addressed independently.
4. `src/mainnet/arcMainnetPay.ts` is **not imported** by unified Preview;
   public Mainnet signing stays disabled. Testnet direct Pay retains the
   existing explicit signing, per-transfer cap and recovery logic.
5. No PostgreSQL, indexing service, cross-device balances, Veyra ID, Swap,
   Convert or Bridge is activated by this change.
6. The MetaMask "Malicious" warning observed on the specific Vercel Preview
   hostname remains open for official review. Do not bypass it or announce
   any domain as cleared without its exact URL being checked.

## Validation requirements

- [ ] CI typecheck, strict lint, Vitest, Vite build, static finance isolation.
- [ ] Browser: desktop/mobile wallet picker and Mainnet/Testnet switch.
- [ ] Browser: Unified assets/networks tabs, search and zero fake positions.
- [ ] Browser: real Arc Mainnet read-only RPC acceptance and no money movement.
- [ ] Confirm the original capped Testnet Pay still behaves as before.
- [ ] Preview READY and a human UX check before release on the main domain.

## Planned next increments

1. Bind curated, locally hosted, license-compliant chain/token logo assets,
   with icon provenance and regression screenshots.
2. Read verified per-chain/per-asset balances only where contracts and RPCs
   are independently validated, with graceful partial failures.
3. Back Veyra ID and Activity by authenticated BFF + durable Postgres; then
   add supported-name recipient lookup and cross-device receipt integrity.
4. Independently enable CCTP Bridge, StableFX Convert and later independent
   DEX Swap according to lifecycle acceptance; the unified catalog does not
   promote any provider on its own.
