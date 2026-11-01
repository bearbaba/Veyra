/**
 * src/lib/settlementVerify.ts
 *
 * Independent payment receipt verifier for VeyraSettlement.pay() transactions.
 *
 * Imported by:
 *   - src/components/pages/SettlementPage.tsx   (production)
 *   - src/tests/settlementGasAndVerification.test.ts  (regression)
 *
 * Design:
 *   - Pure function — no hooks, no side-effects, no imports from wagmi/viem
 *     (only plain types matching viem's TransactionReceipt shape)
 *   - Collects ALL fail reasons, not just the first
 *   - Returns { verified: boolean, failReasons: string[] }
 *   - "VERIFIED" requires ALL 12 checks to pass; any single failure → 'confirmed'
 *
 * The 12 checks:
 *   (a) Chain is Arc (5042002 testnet or 5042 mainnet)
 *   (b) Receipt status is 'success'
 *   (c) Transaction target is the VeyraSettlement contract address
 *   (d) PaymentSettled event emitted by the VeyraSettlement contract (not a forgery)
 *   (e) Payer in event matches the signing wallet
 *   (f) Recipient in event matches the intended recipient
 *   (g) Gross amount in event matches review snapshot
 *   (h) Protocol fee in event matches review snapshot
 *   (i) Net amount (amount − fee) is internally consistent
 *   (j) Payment reference matches review snapshot
 *   (k) USDC Transfer from payer to settlement contract, value = gross amount
 *   (l) USDC Transfer from settlement contract to recipient, value = net amount
 */

export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_MAINNET_CHAIN_ID = 5042;

/** All fields frozen at review time, before any transaction is submitted. */
export interface VerifySnapshot {
  /** Chain ID at the time the user clicked "Review". */
  chainId: number;
  /** Wallet address of the signer. */
  walletAddress: string;
  /** Intended payment recipient. */
  recipient: string;
  /** Gross USDC amount (6-decimal micro-units). */
  amountParsed: bigint;
  /** VeyraSettlement contract address on the active chain. */
  contractAddress: string;
  /** Canonical USDC ERC-20 contract address on the active chain. */
  usdcAddress: string;
  /** Protocol fee in basis points (0–10000). */
  feeBps: bigint;
  /** Protocol fee amount = amountParsed * feeBps / 10000. */
  feeAmount: bigint;
  /** Net amount = amountParsed − feeAmount. */
  netAmount: bigint;
  /** 32-byte CSPRNG payment reference generated at review entry. */
  ref: string;
}

/** Parsed PaymentSettled event arguments, extracted from receipt logs. */
export interface PaymentSettledArgs {
  /** Address of the contract that emitted the event. */
  emitterAddress: string;
  paymentId: string;
  payer: string;
  recipient: string;
  /** Gross amount (= amountParsed). */
  amount: bigint;
  /** Protocol fee. */
  fee: bigint;
  ref: string;
}

/** Parsed ERC-20 Transfer log, extracted from receipt logs. */
export interface TransferLog {
  /** Address of the ERC-20 contract that emitted the Transfer. */
  tokenAddress: string;
  from: string;
  to: string;
  value: bigint;
}

/** Minimal receipt shape — matches viem's TransactionReceipt. */
export interface ReceiptInput {
  /** 'success' | 'reverted' */
  status: string;
  /** Address the transaction was sent to (the contract being called). */
  to: string | null;
  transactionHash: string;
  blockNumber: bigint;
  /** Actual gas consumed — recorded for display. */
  gasUsed: bigint;
}

export interface VerifyResult {
  verified: boolean;
  failReasons: string[];
  /** paymentId from the PaymentSettled event (if found). */
  paymentId: string;
  /** fee as reported by the chain event. */
  feeOnChain: bigint;
  /** net as reported by the chain event. */
  netOnChain: bigint;
  /** ref as reported by the chain event. */
  refOnChain: string;
  /** gasUsed from the receipt. */
  gasUsed: bigint;
  blockNumber: bigint;
  txHash: string;
  /** True when a PaymentSettled event was found (even if some fields didn't match). */
  eventFound: boolean;
}

/**
 * Verify a Direct Pay transaction receipt against the review snapshot.
 *
 * All 12 checks are evaluated; failReasons contains all failures.
 * Returns verified=true only when failReasons is empty.
 */
export function verifyPaymentReceipt(
  receipt: ReceiptInput,
  chainId: number,
  paymentSettledLog: PaymentSettledArgs | null,
  transferLogs: TransferLog[],
  snap: VerifySnapshot,
): VerifyResult {
  const failReasons: string[] = [];

  // (a) Chain is Arc
  if (chainId !== ARC_TESTNET_CHAIN_ID && chainId !== ARC_MAINNET_CHAIN_ID) {
    failReasons.push(`(a) Chain ${chainId} is not Arc (expected 5042002 or 5042)`);
  }

  // (b) Receipt status
  if (receipt.status !== 'success') {
    failReasons.push(`(b) Receipt status is '${receipt.status}', not 'success'`);
  }

  // (c) Transaction target
  if (!receipt.to || receipt.to.toLowerCase() !== snap.contractAddress.toLowerCase()) {
    failReasons.push(
      `(c) Transaction target '${receipt.to ?? 'null'}' does not match contract '${snap.contractAddress}'`
    );
  }

  let paymentId = '0x' + '00'.repeat(32);
  let feeOnChain = 0n;
  let netOnChain = 0n;
  let refOnChain = '0x' + '00'.repeat(32);
  const eventFound = paymentSettledLog !== null;

  if (!eventFound) {
    failReasons.push('(d) PaymentSettled event not found in receipt logs');
    // checks (e)–(j) require the event — mark all as blocked
    failReasons.push('(e)(f)(g)(h)(i)(j) cannot be verified: PaymentSettled event absent');
  } else {
    paymentId = paymentSettledLog.paymentId;
    feeOnChain = paymentSettledLog.fee;
    netOnChain = paymentSettledLog.amount - paymentSettledLog.fee;
    refOnChain = paymentSettledLog.ref;

    // (d) Event emitter must be the VeyraSettlement contract
    if (paymentSettledLog.emitterAddress.toLowerCase() !== snap.contractAddress.toLowerCase()) {
      failReasons.push(
        `(d) PaymentSettled emitted by '${paymentSettledLog.emitterAddress}', expected '${snap.contractAddress}'`
      );
    }

    // (e) Payer
    if (paymentSettledLog.payer.toLowerCase() !== snap.walletAddress.toLowerCase()) {
      failReasons.push(
        `(e) Payer '${paymentSettledLog.payer}' does not match signing wallet '${snap.walletAddress}'`
      );
    }

    // (f) Recipient
    if (paymentSettledLog.recipient.toLowerCase() !== snap.recipient.toLowerCase()) {
      failReasons.push(
        `(f) Recipient '${paymentSettledLog.recipient}' does not match intended '${snap.recipient}'`
      );
    }

    // (g) Gross amount
    if (paymentSettledLog.amount !== snap.amountParsed) {
      failReasons.push(
        `(g) Gross amount ${paymentSettledLog.amount} does not match snapshot ${snap.amountParsed}`
      );
    }

    // (h) Protocol fee
    if (paymentSettledLog.fee !== snap.feeAmount) {
      failReasons.push(
        `(h) Fee ${paymentSettledLog.fee} does not match snapshot ${snap.feeAmount}`
      );
    }

    // (i) Net consistency: net = amount − fee
    const computedNet = paymentSettledLog.amount - paymentSettledLog.fee;
    if (computedNet !== snap.netAmount) {
      failReasons.push(
        `(i) Net ${computedNet} (amount−fee) does not match snapshot net ${snap.netAmount}`
      );
    }

    // (j) Payment reference
    if (paymentSettledLog.ref.toLowerCase() !== snap.ref.toLowerCase()) {
      failReasons.push(
        `(j) Payment ref '${paymentSettledLog.ref}' does not match snapshot '${snap.ref}'`
      );
    }
  }

  // (k) USDC Transfer: payer → settlement contract, value = gross amount
  const payerToContract = transferLogs.find(t =>
    t.tokenAddress.toLowerCase() === snap.usdcAddress.toLowerCase() &&
    t.from.toLowerCase() === snap.walletAddress.toLowerCase() &&
    t.to.toLowerCase() === snap.contractAddress.toLowerCase() &&
    t.value === snap.amountParsed
  );
  if (!payerToContract) {
    failReasons.push(
      `(k) Missing USDC Transfer from payer ${snap.walletAddress} to contract ${snap.contractAddress} ` +
      `for ${snap.amountParsed} (from canonical USDC ${snap.usdcAddress})`
    );
  }

  // (l) USDC Transfer: settlement contract → recipient, value = net amount
  const contractToRecipient = transferLogs.find(t =>
    t.tokenAddress.toLowerCase() === snap.usdcAddress.toLowerCase() &&
    t.from.toLowerCase() === snap.contractAddress.toLowerCase() &&
    t.to.toLowerCase() === snap.recipient.toLowerCase() &&
    t.value === snap.netAmount
  );
  if (!contractToRecipient) {
    failReasons.push(
      `(l) Missing USDC Transfer from contract ${snap.contractAddress} to recipient ${snap.recipient} ` +
      `for ${snap.netAmount} (from canonical USDC ${snap.usdcAddress})`
    );
  }

  return {
    verified: failReasons.length === 0,
    failReasons,
    paymentId,
    feeOnChain,
    netOnChain,
    refOnChain,
    gasUsed: receipt.gasUsed,
    blockNumber: receipt.blockNumber,
    txHash: receipt.transactionHash,
    eventFound,
  };
}
