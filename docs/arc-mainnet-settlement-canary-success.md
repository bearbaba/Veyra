# VeyraSettlement Arc Mainnet — Successful contract payment canary

**Evidence date:** November 1, 2026  
**Status:** SUCCESS according to owner-supplied Arc Explorer and Veyra receipt screenshots.  
**Network:** Arc Mainnet (chain ID 5042)

## Contract-mediated payment

| Field | Evidence |
|---|---|
| Called contract | `0xfbec434fc2190f1887578b7a59b527d1b4acbe98` |
| Function | `pay` |
| Transaction | `0xf7ac133ec0e4cac2a0342760e471c7debc7a3b97a9ad072e998ff4556b590731` |
| Explorer result | Success |
| Block | 29013802 |
| Timestamp shown | November 1, 2026 23:11:12 (UTC+7) |
| Sender | `0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb` |
| Recipient | `0xD6…C2aF` (truncated as displayed in screenshot) |
| Gross | 0.01 USDC |
| Protocol fee | 0 USDC |
| Recipient net | 0.01 USDC |
| Source transfer | Sender → VeyraSettlement: 0.01 USDC |
| Destination transfer | VeyraSettlement → Recipient: 0.01 USDC |
| Network transaction fee | 0.002824096 USDC (Arc Explorer) |
| Gas used | 128368 gas units (Veyra receipt UI) |
| Veyra receipt state | Payment verified |
| Receipt verification checks shown | chain, receipt, contract, event, USDC transfers |

[Open the successful pay() transaction on Arc Explorer](https://explorer.arc.io/tx/0xf7ac133ec0e4cac2a0342760e471c7debc7a3b97a9ad072e998ff4556b590731)

The owner supplied two screenshots: the Veyra `Payment verified` screen and the Arc Explorer `pay` transaction with Success, called contract, and two 0.01 USDC token transfers. This is a **contract-mediated real-USDC payment**. It is distinct from direct wallet-to-wallet Pay, token approval, contract deployment, and the Circle Swap receipt.

**Evidence scope:** The screenshots establish the explorer/app-reported result; no additional independent full raw-log decode or external security audit is claimed here. For a stronger external verification, independently fetch the transaction receipt on Arc Mainnet and compare the contract-emitted `PaymentSettled` event, sender, recipient, amount, fee, and token Transfer logs.

## Related proof

- [Owner-signed contract deployment](https://explorer.arc.io/tx/0xb5092b9269eb9bae4953372ab7fb44683fc14771a418805a7cb2776f6d8b92e9)
- [Mainnet direct-wallet 0.01 USDC Pay](https://explorer.arc.io/tx/0x5bc290fea0e159f936c7d09f1141af074a38db6b31f5e0f3336a47cfd2860a06)
- [Mainnet Circle App Kit Swap USDC → EURC](https://explorer.arc.io/tx/0x4878213f244d7e5b89032a70d059ce79460b8dea34be45293ce1904a40a5f4b2)
- [Production application](https://veyra-seven-beta.vercel.app/)
- [Source contract](../contracts/VeyraSettlement.sol)
