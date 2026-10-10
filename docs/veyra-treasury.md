# Veyra Treasury

Canonical testnet Treasury:

`0xD6b8A3A5eB329410D9504784812b8569afA8C2aF`

This is public configuration only. No private key, seed phrase, or signer secret is stored in the repository.

## Runtime rules

- Testnet uses the canonical address when no override is set.
- A valid `VITE_VEYRA_TREASURY_TESTNET_ADDRESS` may override it for a deployment.
- An invalid non-empty override disables fee collection instead of silently falling back.
- Mainnet has no default Treasury and remains fail-closed until `VITE_VEYRA_TREASURY_MAINNET_ADDRESS` is explicitly configured to a dedicated Safe/multisig.
- Veyra must never fall back to a deployer or personal wallet.

## Fee rules

- Pay: 0 Veyra fee.
- Earn: 0 Veyra fee in v1.
- Bridge and Unified: no fee until verified embedded-fee support exists.
- Swap: 10 bps only on the verified embedded provider fee path.
- No embedded fee support = no Veyra fee.
- No extra transaction or wallet signature may be added solely to collect revenue.
- Veyra-added signatures remain 0.
