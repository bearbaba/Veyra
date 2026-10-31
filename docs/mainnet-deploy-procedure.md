# VeyraSettlement — Arc Mainnet Deploy Procedure

**Status:** Ready for owner-authorized deployment.  
**Contract:** `contracts/VeyraSettlement.sol`  
**Target chain:** Arc Mainnet, chain ID `5042`  
**Prepared:** 2026-10-31  

---

## Prerequisites (verify before executing)

| Item | Required value | How to verify |
|---|---|---|
| Arc Mainnet RPC | `https://rpc.mainnet.arc.io` | `curl -s -X POST -H 'Content-Type: application/json' --data '{"method":"eth_chainId","params":[],"id":1,"jsonrpc":"2.0"}' https://rpc.mainnet.arc.io` should return `0x13b2` (5042) |
| USDC on Arc Mainnet | `0x3600000000000000000000000000000000000000` | `cast call 0x3600000000000000000000000000000000000000 "symbol()(string)" --rpc-url https://rpc.mainnet.arc.io` should return `USDC` |
| Arc Mainnet Explorer | `https://explorer.arc.io` | Browse to confirm it resolves |
| Owner wallet | Your wallet address (NOT the Arc Studio deployer `0x5B12…`) | MetaMask / hardware wallet with sufficient USDC for gas |
| Foundry installed | `forge --version` ≥ 0.2 | `forge --version` |

**Arc Mainnet gas:** On Arc, gas is paid in USDC (the native token). Deploying a contract of this complexity requires approximately 0.5–2 USDC in gas. Have at least 5 USDC on Arc Mainnet in your deployer wallet before proceeding.

---

## Step 1 — Rebuild the contract (Arc Studio or local)

Run inside the Arc Studio workspace or in your local clone:

```bash
cd /path/to/veyra
forge build --root contracts
```

Confirm the artifact exists and is current:
```bash
ls -la contracts/out/VeyraSettlement.sol/VeyraSettlement.json
```

---

## Step 2 — Set environment variables

In your shell (do NOT commit these):

```bash
export PRIVATE_KEY="0x<your-owner-private-key>"
export ARC_MAINNET_RPC="https://rpc.mainnet.arc.io"
export USDC_MAINNET="0x3600000000000000000000000000000000000000"
# Owner address must be your wallet — never the Arc Studio deployer 0x5B12...
export OWNER_ADDRESS="0x<your-wallet-address>"
export FEE_RECIPIENT="0x<your-fee-recipient-address>"
export FEE_BPS="0"  # 0 = no protocol fee
```

---

## Step 3 — Dry-run (simulate, no broadcast)

```bash
forge create \
  --rpc-url "$ARC_MAINNET_RPC" \
  --private-key "$PRIVATE_KEY" \
  --constructor-args \
    "$USDC_MAINNET" \
    "$OWNER_ADDRESS" \
    "$FEE_RECIPIENT" \
    "$FEE_BPS" \
  contracts/VeyraSettlement.sol:VeyraSettlement
```

Remove `--broadcast` from this dry-run. Review the output to confirm:
- No compilation errors
- Constructor args match exactly
- Estimated gas is reasonable (< 5M gas)

---

## Step 4 — Deploy (with broadcast)

```bash
forge create \
  --rpc-url "$ARC_MAINNET_RPC" \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  --constructor-args \
    "$USDC_MAINNET" \
    "$OWNER_ADDRESS" \
    "$FEE_RECIPIENT" \
    "$FEE_BPS" \
  contracts/VeyraSettlement.sol:VeyraSettlement
```

Copy the output:
```
Deployer: 0x<your-wallet>
Deployed to: 0x<contract-address>
Transaction hash: 0x<tx-hash>
```

---

## Step 5 — Verify deployment on Arc Explorer

1. Open `https://explorer.arc.io/tx/<tx-hash>`
2. Confirm the transaction is `Success`
3. Copy the contract address from the explorer
4. Open `https://explorer.arc.io/address/<contract-address>`
5. Confirm contract is deployed and bytecode matches

---

## Step 6 — Verify contract state with cast

```bash
# Confirm USDC address
cast call <CONTRACT_ADDRESS> "usdc()(address)" --rpc-url "$ARC_MAINNET_RPC"
# Expected: 0x3600000000000000000000000000000000000000

# Confirm owner
cast call <CONTRACT_ADDRESS> "owner()(address)" --rpc-url "$ARC_MAINNET_RPC"
# Expected: your owner wallet address

# Confirm feeBps
cast call <CONTRACT_ADDRESS> "feeBps()(uint256)" --rpc-url "$ARC_MAINNET_RPC"
# Expected: 0
```

---

## Step 7 — Register the deployment in the codebase

Once verified, open `src/config/veyraSettlement.ts` and fill in the mainnet entry:

```typescript
mainnet: {
  address: '0x<CONTRACT_ADDRESS>' as const,
  deployTxHash: '0x<TX_HASH>' as const,
  deployedAt: '<ISO_TIMESTAMP>',
  explorerUrl: 'https://explorer.arc.io/address/0x<CONTRACT_ADDRESS>',
  chainId: ARC_MAINNET_CHAIN_ID,
  usdcAddress: ARC_MAINNET_USDC,
  feeBps: 0,
} satisfies VeyraSettlementDeployment,
```

Also update `AGENTS.md` with the deployment address and transaction hash.

---

## Step 8 — Low-value end-to-end test

Before declaring production-ready:

1. Connect your owner wallet to the Veyra app on Arc Mainnet
2. Navigate to Settlement
3. Send a **small** amount (e.g., 0.01 USDC) to a test address you control
4. Confirm the explorer shows the payment event
5. Confirm the recipient received the USDC

Only after confirming this test transaction should the mainnet settlement be considered live.

---

## Security checklist

- [ ] Owner is YOUR wallet (not Arc Studio's deployer `0x5B12…`)
- [ ] Private key is not committed to git or stored in `.env`
- [ ] USDC address is `0x3600000000000000000000000000000000000000` (Arc Mainnet)
- [ ] Chain ID is `5042` (Arc Mainnet, not 5042002 testnet)
- [ ] Contract has been independently reviewed
- [ ] feeBps is set as intended
- [ ] Explorer confirms successful deployment

---

## Emergency: disabling the contract

If an issue is discovered after mainnet deployment, the owner can call `pause()` on the contract to halt all payments and escrow creation. Existing escrows can still be released or refunded. There is no owner path to withdraw user escrowed funds — escrow release is controlled exclusively by the payer and the recipient.

---

**Arc Studio note:** Arc Studio deployed VeyraSettlement to Arc Testnet using its shared platform deployer wallet. Mainnet deployment MUST be done by the owner (you) using your own wallet and private key, as described above. Arc Studio cannot deploy to mainnet on your behalf.
