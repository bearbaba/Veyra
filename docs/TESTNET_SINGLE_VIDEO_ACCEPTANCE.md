# Veyra integrated Testnet acceptance — Circle Gateway source of funds

Status: **NOT ACCEPTED** (2026-10-29). This supersedes the obsolete definition of "Unified" as a sum of wallet balances. Preserve the six product capabilities and Activity.

## Product contract
- Wallet balances: USDC still held in connected wallet across independent networks; read only.
- Unified Balance: exact USDC deposited to Circle Gateway, available after finality. Query official Testnet `POST /v1/balances` for verified depositor/domain tuples. This is a *separate* source of funds; NEVER add wallet balances to Gateway funds.
- Pending deposits: on-chain deposit tx sent/confirmed, but provider's available balance not yet credited; do not count as spendable.
- Funding source is `CONNECTED_WALLET` or `GATEWAY_UNIFIED`, a property of Pay/Swap, **not a kind of Agent command**.
- Agent: short multilingual chat, single Active task Review/Sign/Track/Receipt. Bridge is a wallet-origin CCTP action, not an automatic fallback for Gateway Send/Deposit.
- X binds to existing Veyra ID; wallet change invalidates review and authorization but never erases owner-bound pending receipts.
- No Mainnet until independent review and owner approval; no mocked swaps, fake quote, fake tx or fabricated Gateway available amounts.

## Verified Circle Testnet contract and API references
- Gateway Wallet: `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`; Gateway Minter: `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`.
- Supported Veyra-source matrix: Arc Testnet domain 26 (5042002), Ethereum Sepolia domain 0 (11155111), Base Sepolia domain 6 (84532). Verify active chain's pinned USDC bytecode before deposit or any money movement.
- Gateway API Testnet: `https://gateway-api-testnet.circle.com/v1/balances` POST `{token:"USDC",sources:[{domain,depositor}]}`. Zero is real **only when verified exact provider row returns zero**; missing data/errors are unknown.
- Deposit is **approve USDC if necessary** followed by Gateway Wallet `deposit(address,uint256)`; plain USDC `transfer` to Gateway Wallet is **not** a deposit and can lose funds.
- Gateway transfer is user-signed BurnIntent EIP-712 → Gateway API `POST /transfer` (with idempotent durable task) → verify attestation → destination Minter `gatewayMint` → destination transaction confirmation and receiver balance change. Signed intent/attestation alone is not completion.
- Gateway user can initiate withdrawal through the official delayed recovery process; never promise instant recovery.

## Full release gates before the **single user acceptance video**
1. Unified Available + Pending + Wallet details correct for active signer, independently read by Gateway and chain RPC. Deposits from 3 verified Testnets, persisted after refresh; no double counts.
2. Gateway Send: source allocation hidden from user but deterministic/capped by available provider domain balances; user reviews amount, destination recipient/network, fee, bound expiry; one fresh EIP-712 intent per source; no resend if API outcome unknown; destination mint verified and owner receipt persisted.
3. Wallet Send and Veyra ID Pay: real exact transfer to a verified resolver-selected wallet with owner receipt, refresh/chain/wallet switch protections.
4. Wallet Swap: real supported route (StableFX entitlement or verified DEX Testnet pool), approval/quote/funding/settlement and exact token delta. Unified Swap: Gateway-send-to-funding route only after compatible provider and full failure/recovery state; no false atomicity or automatic re-fund.
5. Wallet Bridge: CCTP forward and reverse between *published supported* testnets, source burn + attestation + destination receive + on-chain success, resumable without repeat burn.
6. X OAuth linking the same Veyra ID, browser/Render trusted callback and session persistence. Private Activity shows Deposit, Gateway Send, Pay, Swap, Bridge and pending tasks.
7. Mobile/desktop E2E: reject signatures, insufficient funds/allowance, wrong chain, wallet disconnect, stale quote, duplicate click, RPC/API timeout, source success + destination failure, after reload at each pending stage; clear UI and console.

## Verified gaps at current Draft PR
- Existing `AgentUnifiedBalances` used to calculate sum of 3 wallet ERC20 reads and brand it Unified. Corrected Gateway query/UI and Gateway deposit code are now being added; they are **not deployed to the live V2 domain**.
- Gateway Send signed transfer + destination Minter/receipt, unified-funded Swap, reverse CCTP still lack production-shaped signed E2E; no video acceptance.
- StableFX TEST key absent on Render startup logs; provider entitlement and real USDC/EURC settlement unverified. Circle Gateway is permissionless and must not be blocked by StableFX entitlement.
- X OAuth callback/origin/credentials E2E not verified.
- Do not silently enable feature flags or swap routers to make the video look complete.

## Integration/rollback procedure
Retain `veyra-unified-testnet-v2.vercel.app` on existing stable SHA until candidate is approved. Stage a single exact-commit Vercel Preview and coordinate BFF/migrations with backed-up Testnet PostgreSQL. Rollback frontend/BFF only; never assume rollback reverses on-chain transactions. CI green is not enough for owner video.

## Canonical sources
- https://developers.circle.com/gateway/howtos/create-unified-usdc-balance
- https://developers.circle.com/gateway/howtos/transfer-unified-usdc-balance
- https://raw.githubusercontent.com/circlefin/skills/master/plugins/circle/skills/use-gateway/references/query-balance.md
- https://raw.githubusercontent.com/circlefin/skills/master/plugins/circle/skills/use-gateway/references/deposit-evm-browser-wallet.md
