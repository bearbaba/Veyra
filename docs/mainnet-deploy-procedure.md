# VeyraSettlement — Arc Mainnet Deploy Procedure

**Status:** Ready for owner-authorized deployment. Deployment is NOT yet authorized.
**Contract source:** `contracts/VeyraSettlement.sol`
**Target chain:** Arc Mainnet · chain ID `5042`
**Prepared:** 2026-11-01

> **This document requires explicit owner approval before any transaction is broadcast.**
> Do not execute Step 5 until you have read and confirmed every prerequisite,
> verified the simulation output, and given explicit authorization.

---

## Exact constructor arguments

| Parameter | Type | Value |
|-----------|------|-------|
| `usdc_` | address | `0x3600000000000000000000000000000000000000` |
| `initialOwner` | address | **YOUR wallet address** — NOT `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42` |
| `feeRecipient_` | address | Your wallet (or a dedicated treasury address you control) |
| `feeBps_` | uint16 | `0` — zero protocol fee at launch |

> `feeBps_=0` means `feeRecipient_` is never called at runtime (the contract checks this).
> Any non-zero value here would charge that percentage on every payment and escrow release.
> Confirm this is correct before authorizing.

---

## Exact compilation parameters (must reproduce)

| Setting | Value |
|---------|-------|
| Solidity | `0.8.28+commit.7893614a` |
| EVM target | `paris` |
| Optimizer | enabled, 200 runs |
| Source SHA-256 | `5a6785953424a887bfc05a264237a1ed37076f15490a23a780b63fcbb317ad4b` |
| Creation bytecode size | 5996 bytes |
| Creation bytecode keccak256 | `0xc70cdb0b5f3b9bdd698e44bfae66f6b76475b3a05686c950be33d7c444aad3d2` |

> **Note on hash algorithm:** The hash above is Ethereum Keccak-256 (keccak256), not SHA3-256.
> These are different algorithms. The previous iteration of this document incorrectly used
> `hashlib.sha3_256` (Python's SHA-3/Keccak variant) — that produces a different digest.
> The value above was computed with Foundry's `cast keccak` which uses Ethereum's Keccak-256.
> Use the verification command in Step 2 to reproduce it.

You can verify the source hash before building:

```bash
sha256sum contracts/VeyraSettlement.sol
# expected: 5a6785953424a887bfc05a264237a1ed37076f15490a23a780b63fcbb317ad4b
```

---

## Prerequisites (verify every item before proceeding)

### Chain verification

```bash
# Chain ID must be 5042 (0x13b2)
curl -s -X POST \
  -H 'Content-Type: application/json' \
  --data '{"method":"eth_chainId","params":[],"id":1,"jsonrpc":"2.0"}' \
  https://rpc.mainnet.arc.io
# expected: {"result":"0x13b2",...}

# USDC contract on Arc Mainnet
cast call 0x3600000000000000000000000000000000000000 \
  "symbol()(string)" \
  --rpc-url https://rpc.mainnet.arc.io
# expected: USDC

cast call 0x3600000000000000000000000000000000000000 \
  "decimals()(uint8)" \
  --rpc-url https://rpc.mainnet.arc.io
# expected: 6
```

### Tooling

```bash
forge --version   # must be ≥ 0.2 (Foundry)
cast  --version   # ships with Foundry
```

### Gas balance

On Arc, gas is paid in USDC (the native token). Deploying this contract requires
approximately 0.5–2 USDC. Have at least 5 USDC on Arc Mainnet in your deployer
wallet before proceeding.

```bash
cast balance YOUR_WALLET_ADDRESS --rpc-url https://rpc.mainnet.arc.io --ether
# "ether" units here are USDC units on Arc — same 18-decimal native denomination
```

---

## Step 1 — Clone the repository locally

```bash
git clone https://github.com/bearbaba/Veyra.git veyra-deploy
cd veyra-deploy
git checkout arc-studio/mainnet
git log --oneline -3   # confirm you are on the right commit
```

Verify the source hash matches:

```bash
sha256sum contracts/VeyraSettlement.sol
# expected: 5a6785953424a887bfc05a264237a1ed37076f15490a23a780b63fcbb317ad4b
```

---

## Step 2 — Build the contract

The correct build command uses `foundry.toml` at the project root (NOT `--root contracts`).
The `--root contracts` flag would search inside `contracts/` for library remappings,
missing `node_modules/@openzeppelin` which lives at the project root.

```bash
# From the project root (veyra-deploy/)
forge build

# Confirm the artifact was produced
ls -la contracts/out/VeyraSettlement.sol/VeyraSettlement.json

# Verify creation bytecode Keccak-256 using Foundry's cast keccak
# (cast keccak uses Ethereum Keccak-256, not SHA3-256 — these are different)
BYTECODE=$(cat contracts/out/VeyraSettlement.sol/VeyraSettlement.json \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['bytecode']['object'])")
echo "Creation bytecode hex length: ${#BYTECODE} chars (expect 11994 for 5997 bytes incl. 0x prefix)"
cast keccak "$BYTECODE"
# expected: 0xc70cdb0b5f3b9bdd698e44bfae66f6b76475b3a05686c950be33d7c444aad3d2
#
# Alternative: python3 using the eth-hash library (Ethereum Keccak-256):
#   pip install pysha3
#   python3 -c "
#     import sys, json, sha3
#     d = json.load(open('contracts/out/VeyraSettlement.sol/VeyraSettlement.json'))
#     bc = d['bytecode']['object']
#     raw = bytes.fromhex(bc[2:] if bc.startswith('0x') else bc)
#     k = sha3.keccak_256(); k.update(raw); print('0x' + k.hexdigest())
#   "
#
# DO NOT use hashlib.sha3_256 — that is Python's SHA-3 (FIPS 202 variant),
# which produces a different hash from Ethereum's Keccak-256.
```

If the hash does not match, **stop**. The build is not reproducible from this source
commit. Do not deploy until the mismatch is investigated.

---

## Step 3 — Set up a hardware wallet or encrypted keystore

**Never export your primary private key in plaintext. Never pass a private key
via `--private-key` on a production deployment.**

### Option A — Hardware wallet (Ledger / Trezor) via `cast` / `forge`

Foundry natively supports hardware wallet signing:

```bash
# Ledger (EIP-712 / EIP-155 signing)
forge create \
  --rpc-url https://rpc.mainnet.arc.io \
  --ledger \
  --hd-path "m/44'/60'/0'/0/0" \
  --constructor-args \
    0x3600000000000000000000000000000000000000 \
    YOUR_OWNER_ADDRESS \
    YOUR_FEE_RECIPIENT_ADDRESS \
    0 \
  contracts/VeyraSettlement.sol:VeyraSettlement
```

```bash
# Trezor
forge create \
  --rpc-url https://rpc.mainnet.arc.io \
  --trezor \
  --hd-path "m/44'/60'/0'/0/0" \
  --constructor-args \
    0x3600000000000000000000000000000000000000 \
    YOUR_OWNER_ADDRESS \
    YOUR_FEE_RECIPIENT_ADDRESS \
    0 \
  contracts/VeyraSettlement.sol:VeyraSettlement
```

Foundry will prompt you to confirm the transaction on your device before
broadcasting. Verify all constructor arguments on the device screen.

### Option B — Encrypted keystore

```bash
# Create an encrypted keystore from your private key (one-time setup)
cast wallet import deployer --interactive
# You will be prompted for the private key and a password.
# The key is stored encrypted at ~/.foundry/keystores/deployer

# Deploy using the encrypted keystore
forge create \
  --rpc-url https://rpc.mainnet.arc.io \
  --account deployer \
  --constructor-args \
    0x3600000000000000000000000000000000000000 \
    YOUR_OWNER_ADDRESS \
    YOUR_FEE_RECIPIENT_ADDRESS \
    0 \
  contracts/VeyraSettlement.sol:VeyraSettlement
# You will be prompted for the keystore password at signing time.
```

---

## Step 4 — Simulate (dry-run, NO broadcast)

Run the same command without `--broadcast` first (the default for `forge create`
is to NOT broadcast — it only simulates). This lets you confirm:

- No compilation errors
- Constructor args encoded correctly (check the ABI-encoded calldata in output)
- Estimated gas is reasonable (< 5 million gas units)

```bash
# Dry-run with ledger — shows estimated gas and encoded args, does NOT broadcast
forge create \
  --rpc-url https://rpc.mainnet.arc.io \
  --ledger \
  --hd-path "m/44'/60'/0'/0/0" \
  contracts/VeyraSettlement.sol:VeyraSettlement \
  --constructor-args \
    0x3600000000000000000000000000000000000000 \
    YOUR_OWNER_ADDRESS \
    YOUR_FEE_RECIPIENT_ADDRESS \
    0
```

Confirm the simulation output shows:
- `Estimated gas` < 5,000,000
- `Constructor arguments` matches the four values above
- No revert or compilation error

---

## Step 5 — BROADCAST (requires explicit authorization)

**Do not execute this step without explicit written authorization.**

Add `--broadcast` to the command from Step 4:

```bash
forge create \
  --rpc-url https://rpc.mainnet.arc.io \
  --ledger \
  --hd-path "m/44'/60'/0'/0/0" \
  --broadcast \
  contracts/VeyraSettlement.sol:VeyraSettlement \
  --constructor-args \
    0x3600000000000000000000000000000000000000 \
    YOUR_OWNER_ADDRESS \
    YOUR_FEE_RECIPIENT_ADDRESS \
    0
```

Record the output:
```
Deployer:         0x<your-wallet>
Deployed to:      0x<CONTRACT_ADDRESS>
Transaction hash: 0x<TX_HASH>
```

---

## Step 6 — Verify on Arc Explorer

1. Open `https://explorer.arc.io/tx/TX_HASH`
2. Transaction status must be `Success`
3. Open `https://explorer.arc.io/address/CONTRACT_ADDRESS`
4. Confirm the contract is deployed

---

## Step 7 — Verify contract storage with cast

```bash
export CONTRACT=0x<CONTRACT_ADDRESS>
export RPC=https://rpc.mainnet.arc.io

# USDC address
cast call $CONTRACT "usdc()(address)" --rpc-url $RPC
# expected: 0x3600000000000000000000000000000000000000

# Owner
cast call $CONTRACT "owner()(address)" --rpc-url $RPC
# expected: YOUR_OWNER_ADDRESS (NOT 0x5B12...)

# feeBps
cast call $CONTRACT "feeBps()(uint16)" --rpc-url $RPC
# expected: 0

# Not paused
cast call $CONTRACT "paused()(bool)" --rpc-url $RPC
# expected: false
```

---

## Step 8 — Register in the codebase

Tell Arc Studio the deployed address. Arc Studio will update `src/config/veyraSettlement.ts`:

```typescript
mainnet: {
  address: '0xCONTRACT_ADDRESS' as const,
  deployTxHash: '0xTX_HASH' as const,
  deployedAt: 'ISO_TIMESTAMP',
  explorerUrl: 'https://explorer.arc.io/address/0xCONTRACT_ADDRESS',
  chainId: ARC_MAINNET_CHAIN_ID,
  usdcAddress: ARC_MAINNET_USDC,
  feeBps: 0,
} satisfies VeyraSettlementDeployment,
```

---

## Step 9 — Canary payment (required before Production promotion)

1. Connect your owner wallet to the Veyra app on Arc Mainnet
2. Navigate to Settlement
3. Send exactly **0.01 USDC** to a test address you control
4. Confirm the Settlement page shows "Payment verified" with the PaymentSettled event
5. Confirm the recipient received 0.01 USDC
6. Arc Studio will extract the on-chain PaymentSettled event details

Only after this verified canary payment should mainnet Settlement be declared live.

---

## Security checklist

- [ ] Owner address is YOUR wallet (NOT `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42`)
- [ ] Private key never passed in plaintext — hardware wallet or encrypted keystore used
- [ ] USDC address is `0x3600000000000000000000000000000000000000` (Arc Mainnet)
- [ ] Chain ID is `5042` (NOT 5042002 testnet)
- [ ] Source SHA-256 verified before build
- [ ] Creation bytecode keccak256 verified after build
- [ ] Simulation (Step 4) completed without errors
- [ ] You have explicit authorization from the contract owner to broadcast
- [ ] Arc Explorer confirms successful deployment
- [ ] All four `cast call` checks in Step 7 pass
- [ ] Canary payment verified on-chain (Step 9)

---

## Emergency: pausing the contract

If an issue is discovered after deployment, the owner can call `pause()` to halt
all new payments and escrow creation. This requires calling the contract from
the owner wallet:

```bash
cast send CONTRACT_ADDRESS "pause()" \
  --rpc-url https://rpc.mainnet.arc.io \
  --ledger \
  --hd-path "m/44'/60'/0'/0/0"
```

Existing escrows remain releasable and refundable after pause.
There is no owner function to withdraw user-escrowed funds — that is intentional.

---

## What this document does NOT cover

- Independent third-party security audit: this procedure assumes you have completed
  or accepted the security review limitations described in `docs/arc-microgrants-evidence.md`.
  Arc Studio's internal review is NOT a substitute for a paid independent audit for
  production financial contracts.
- Vercel Production promotion: handled separately after canary payment evidence.
- Mainnet provider activation (Swap, Bridge, Earn, Gateway): each remains capability-specific
  and requires its own activation gate.
