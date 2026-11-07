# VeyraSettlement V2 — owner approval required before any deployment

This is a **new non-upgradeable contract**. It must never overwrite the legacy Arc Mainnet contract at `0xfbec434fc2190f1887578b7a59b527d1b4acbe98`. No mainnet signing flags, contract address or registry entry are changed by this proposal.

## Exact uniqueness guarantee

- `pay(recipient, amount, ref)` requires nonzero `ref` and consumes `payerRefUsed[msg.sender][ref]`. Ordinary Pay/Tip can never spend the same reference twice *from the same payer wallet*. Other payers cannot squat this namespace.
- `payRequest(recipient, amount, ref, deadline, signature)` verifies the requester's **recipient wallet** signature over `PaymentRequest(payer,recipient,amount,ref,deadline)` with EIP-712 domain `VeyraSettlement` version `2`, current chain ID and exact new contract address. The caller must be the authorized payer. It consumes both `payerRefUsed[msg.sender][ref]` and global `requestRefUsed[ref]`.
- The issuing recipient cannot prevent an unrelated person from voluntarily paying them with the same generic ref, but an unauthorized payer **cannot consume or lock the request reference**. Only the signed `payRequest()` route counts as the canonical Request receipt.
- A failed ERC20 transfer, noncanonical signature, invalid deadline, replay, reentrancy or any revert rolls back reference consumption atomically.
- The public payer-specific guarantee does **not** apply across different payers or the legacy V1 deployment. It is not a substitute for wallet/session-bound journal, provider UNKNOWN recovery, or server CAS locks.

## Integration requirements before opening V2 publicly

1. Obtain a wallet-authorized **recipient-issued request signature** at creation (or provide a clearly separate request-signing step). Backend binds the immutable issuer user ID, requester wallet binding, payer wallet, amount, ref, deadline, contract address, chain ID and signature. Merely minting a UUID/DB row is insufficient.
2. Prepare ABI and registry for both V1 (read-only historical receipts) and V2 (new payments only), using **exact deployed bytecode**, owner, fee recipient, fee BPS, chain ID and canonical USDC readbacks. Do not silently change `getVeyraSettlementDeployment`.
3. Frontend review simulates `pay()` or `payRequest()` with all calldata frozen before signature; network gas and approval gas reviewed separately. No optimistic `Paid`.
4. Backend canonical proof verifier recognizes V2's exact address and function selector. It must verify `payRequest` calldata, issuer signature, final block and USDC Transfer logs before marking the typed Request PAID; generic `pay` must not satisfy a signed Request. Retain the V1 verifier for all historical receipts; do not replay transactions.
5. Rollout: owner reviews tests, creation bytecode hash, signer domain and fees; owner signs a NEW deployment after full review; perform read-only deployed-code checks; deploy backend schema/receipt verifier; update frontend registry on the existing service in a canary release; only then test two-wallet payments.
6. Preserve the old contract's address and historical receipt decoder. An existing claimed/pending V1 Request remains pinned to V1; never rewrite its payment ref or auto-broadcast it on V2.

## Acceptance tests

Foundry suite `contracts/test/VeyraSettlementV2.t.sol` covers same payer replay, unrelated payer ref squatting, signed request replay, wrong payer/recipient/amount/deadline/domain, token-transfer revert without ref consumption, duplicate competing authorized payer, and reentrancy callback.

**Approval point:** Do not deploy, publish a new Production address or make the contract publicly signable until the owner has accepted the reviewed creation bytecode, function ABI, migration, E2E canaries and rollback boundary. This file is technical release evidence only.
