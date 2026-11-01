# VeyraSettlement — Arc Mainnet owner-signed deployment evidence

The owner supplied a screenshot of the Veyra onchain verification screen on 2026-11-01. This is **app-reported evidence**, not independent Arc RPC verification by the maintainer.

- Network: Arc Mainnet, chain ID 5042
- Contract: `0xfbec434fc2190f1887578b7a59b527d1b4acbe98`
- Deployment transaction: `0xb5092b9269eb9bae4953372ab7fb44683fc14771a418805a7cb2776f6d8b92e9`
- Initial owner and fee recipient: `0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb`
- Token: Arc native USDC ERC-20 `0x3600000000000000000000000000000000000000`
- Initial fee: 0 bps
- GitHub Actions compiled creation bytecode Keccak: `0xc70cdb0b5f3b9bdd698e44bfae66f6b76475b3a05686c950be33d7c444aad3d2`
- Creation bytecode source SHA-256: `5a6785953424a887bfc05a264237a1ed37076f15490a23a780b63fcbb317ad4b`
- Contract source: `contracts/VeyraSettlement.sol`
- Deployment artifact: `src/generated/veyraSettlementCreation.ts`
- Reproducible compilation: [GitHub Actions run](https://github.com/bearbaba/Veyra/actions/runs/41321132145)
- [Arc Explorer deployment transaction](https://explorer.arc.io/tx/0xb5092b9269eb9bae4953372ab7fb44683fc14771a418805a7cb2776f6d8b92e9)
- [Arc Explorer contract](https://explorer.arc.io/address/0xfbec434fc2190f1887578b7a59b527d1b4acbe98)

**Mainnet live financial signing gates:** production verifies chain ID, exact deployment calldata, owner, deployment receipt, contract address and runtime presence, `usdc()`, `feeBps()`, and `paused()` against the live Arc Mainnet RPC, and blocks signing if any check fails. The app-reported success alone is not sufficient for a payment.

**Contract-mediated payment completed, November 1, 2026:** The owner supplied Arc Explorer and Veyra screenshots showing a successful `pay()` transaction on the deployed Mainnet contract, gross 0.01 USDC, net 0.01 USDC, 0 protocol fee, and both sender → contract and contract → recipient USDC token transfers. Veyra displayed `Payment verified`. See the [successful 0.01 USDC contract-mediated payment](arc-mainnet-settlement-canary-success.md) and [the Arc transaction](https://explorer.arc.io/tx/0xf7ac133ec0e4cac2a0342760e471c7debc7a3b97a9ad072e998ff4556b590731). Separate external raw-log decoding and security audit remain unclaimed.
