/**
 * Veyra CCTP V2 End-to-End Testnet Validation Script
 *
 * Arc Testnet (source, domain 26) → Ethereum Sepolia (destination, domain 0)
 *
 * This script handles:
 * 1. Pre-flight: balance snapshot + allowance check
 * 2. Attestation polling after burn tx is provided
 * 3. Post-receive balance verification
 * 4. VeyraReceipt generation
 *
 * The two wallet signatures (approve + depositForBurn) are done in the browser.
 * This script does NOT hold private keys.
 *
 * Usage:
 *   Phase 1 (preflight):  bun run scripts/cctp-e2e.ts preflight <walletAddress>
 *   Phase 2 (attest):     bun run scripts/cctp-e2e.ts attest <burnTxHash>
 *   Phase 3 (verify):     bun run scripts/cctp-e2e.ts verify <walletAddress> <receiveTxHash> <burnTxHash>
 */

import { createPublicClient, http, formatUnits, type Address, type Hash } from 'viem';
import { readFile, writeFile } from 'fs/promises';

// ── Chain definitions (from manifest — no typed-from-memory values) ────────────

const ARC_TESTNET = {
  id: 5042002,
  name: 'Arc Testnet',
  rpcUrl: 'https://rpc.testnet.arc.io',
  usdc: '0x3600000000000000000000000000000000000000' as Address,
  cctpDomain: 26,
  explorer: 'https://explorer.testnet.arc.io',
};

const ETH_SEPOLIA = {
  id: 11155111,
  name: 'Ethereum Sepolia',
  rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address,
  cctpDomain: 0,
  explorer: 'https://sepolia.etherscan.io',
};

const CCTP_V2 = {
  tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' as Address,
  messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' as Address,
  attestationApi: 'https://iris-api-sandbox.circle.com',
};

// ── Test parameters ───────────────────────────────────────────────────────────

const TEST_AMOUNT_RAW = 1_000_000n; // 1 USDC at 6 decimals
const TEST_AMOUNT_HUMAN = '1.000000';

// ── ABI fragments ─────────────────────────────────────────────────────────────

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ── Clients ───────────────────────────────────────────────────────────────────

function makeArcClient() {
  return createPublicClient({
    transport: http(ARC_TESTNET.rpcUrl),
    chain: { id: ARC_TESTNET.id, name: ARC_TESTNET.name, nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [ARC_TESTNET.rpcUrl] } } },
  });
}

function makeSepoliaClient() {
  return createPublicClient({
    transport: http(ETH_SEPOLIA.rpcUrl),
    chain: { id: ETH_SEPOLIA.id, name: ETH_SEPOLIA.name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [ETH_SEPOLIA.rpcUrl] } } },
  });
}

// ── Phase 1: Preflight ────────────────────────────────────────────────────────

async function runPreflight(walletAddress: Address) {
  console.log('\n═══ CCTP V2 E2E Preflight ═══');
  console.log('Wallet:', walletAddress);
  console.log('Amount:', TEST_AMOUNT_HUMAN, 'USDC');
  console.log('Route: Arc Testnet → Ethereum Sepolia');
  console.log('');

  const arcClient = makeArcClient();
  const sepoliaClient = makeSepoliaClient();

  // 1. Arc Testnet USDC balance
  const arcUsdcRaw = await arcClient.readContract({
    address: ARC_TESTNET.usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [walletAddress],
  });
  const arcUsdcHuman = formatUnits(arcUsdcRaw, 6);
  console.log(`[ARC]    USDC balance: ${arcUsdcHuman} USDC (raw: ${arcUsdcRaw})`);

  // 2. Arc Testnet native gas balance
  const arcNativeRaw = await arcClient.getBalance({ address: walletAddress });
  const arcNativeHuman = formatUnits(arcNativeRaw, 18);
  console.log(`[ARC]    Native gas:   ${arcNativeHuman} USDC (18-dec native)`);

  // 3. ETH Sepolia ETH balance
  const sepoliaEthRaw = await sepoliaClient.getBalance({ address: walletAddress });
  const sepoliaEthHuman = formatUnits(sepoliaEthRaw, 18);
  console.log(`[SEPOLIA] ETH balance: ${sepoliaEthHuman} ETH`);

  // 4. ETH Sepolia USDC balance (before-state for delta)
  const sepoliaUsdcRaw = await sepoliaClient.readContract({
    address: ETH_SEPOLIA.usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [walletAddress],
  });
  const sepoliaUsdcHuman = formatUnits(sepoliaUsdcRaw, 6);
  console.log(`[SEPOLIA] USDC balance (before): ${sepoliaUsdcHuman} USDC (raw: ${sepoliaUsdcRaw})`);

  // 5. TokenMessengerV2 allowance
  const allowance = await arcClient.readContract({
    address: ARC_TESTNET.usdc,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [walletAddress, CCTP_V2.tokenMessenger],
  });
  console.log(`[ARC]    Allowance for TokenMessengerV2: ${formatUnits(allowance, 6)} USDC (raw: ${allowance})`);

  console.log('');

  // Validation
  const checks: { name: string; pass: boolean; detail: string }[] = [];
  checks.push({ name: 'Arc USDC sufficient', pass: arcUsdcRaw >= TEST_AMOUNT_RAW, detail: `${arcUsdcHuman} USDC >= ${TEST_AMOUNT_HUMAN}` });
  checks.push({ name: 'Arc native gas > 0', pass: arcNativeRaw > 0n, detail: `${arcNativeHuman} USDC-gas` });
  checks.push({ name: 'Sepolia ETH > 0', pass: sepoliaEthRaw > 0n, detail: `${sepoliaEthHuman} ETH` });
  checks.push({ name: 'Allowance check', pass: true, detail: allowance >= TEST_AMOUNT_RAW ? `sufficient (${formatUnits(allowance,6)})` : `NEEDS APPROVE — send approve(${CCTP_V2.tokenMessenger}, ${TEST_AMOUNT_RAW})` });

  let allPass = true;
  for (const c of checks) {
    const icon = c.pass ? '✓' : '✗';
    console.log(`  ${icon} ${c.name}: ${c.detail}`);
    if (!c.pass) allPass = false;
  }

  console.log('');

  if (!allPass) {
    console.error('PREFLIGHT FAILED — do not proceed until all checks pass.');
    process.exit(1);
  }

  console.log('PREFLIGHT PASSED');
  console.log('');

  // Encode the exact transactions the user needs to sign
  const needsApprove = allowance < TEST_AMOUNT_RAW;

  if (needsApprove) {
    console.log('══ SIGNATURE 1 of 2: APPROVE ══');
    console.log(`Contract: ${ARC_TESTNET.usdc}  (Arc Testnet USDC)`);
    console.log(`Function: approve(address spender, uint256 amount)`);
    console.log(`  spender: ${CCTP_V2.tokenMessenger}  (TokenMessengerV2)`);
    console.log(`  amount:  ${TEST_AMOUNT_RAW}  (${TEST_AMOUNT_HUMAN} USDC)`);
    console.log('Chain: Arc Testnet (5042002)');
    console.log('');
    console.log('→ In Veyra Bridge page, click "Approve USDC" to sign this transaction.');
    console.log('→ After MetaMask confirms, provide the approve tx hash here.');
  } else {
    console.log('Allowance already sufficient — skipping approve.');
  }

  console.log('');
  console.log('══ SIGNATURE 2 of 2: depositForBurn ══');
  console.log(`Contract: ${CCTP_V2.tokenMessenger}  (TokenMessengerV2 on Arc Testnet)`);
  console.log(`Function: depositForBurn(`);
  console.log(`  amount:                ${TEST_AMOUNT_RAW},`);
  console.log(`  destinationDomain:     0,  // Ethereum Sepolia`);
  console.log(`  mintRecipient:         0x000000000000000000000000${walletAddress.slice(2).toLowerCase()},`);
  console.log(`  burnToken:             ${ARC_TESTNET.usdc},`);
  console.log(`  destinationCaller:     0x${'00'.repeat(32)},  // anyone can relay`);
  console.log(`  maxFee:                0,`);
  console.log(`  minFinalityThreshold:  2000  // standard`);
  console.log(`)`);
  console.log('Chain: Arc Testnet (5042002)');
  console.log('');
  console.log('→ After approve confirms, click "Bridge" in Veyra to sign depositForBurn.');
  console.log('→ After MetaMask confirms, run: bun run scripts/cctp-e2e.ts attest <burnTxHash>');

  // Save before-state for later verification
  const state = {
    walletAddress,
    testAmountRaw: TEST_AMOUNT_RAW.toString(),
    arcUsdcBefore: arcUsdcRaw.toString(),
    sepoliaUsdcBefore: sepoliaUsdcRaw.toString(),
    sepoliaEthBefore: sepoliaEthRaw.toString(),
    needsApprove,
    timestamp: Date.now(),
  };
  await writeFile('/tmp/cctp-e2e-state.json', JSON.stringify(state, null, 2));
  console.log('Before-state saved to /tmp/cctp-e2e-state.json');
}

// ── Phase 2: Poll attestation ─────────────────────────────────────────────────

async function pollAttestation(burnTxHash: Hash) {
  const stateRaw = await readFile('/tmp/cctp-e2e-state.json', 'utf-8').catch(() => null);
  if (!stateRaw) {
    console.error('No preflight state found. Run preflight first.');
    process.exit(1);
  }
  const state = JSON.parse(stateRaw) as { walletAddress: string };

  console.log('\n═══ CCTP V2 Attestation Polling ═══');
  console.log('Burn tx:', burnTxHash);

  // 1. Verify source tx receipt on Arc Testnet
  const arcClient = makeArcClient();
  console.log('\n[1] Verifying source tx on Arc Testnet...');

  let receipt;
  try {
    receipt = await arcClient.waitForTransactionReceipt({ hash: burnTxHash, timeout: 30_000 });
  } catch {
    console.error('Source tx not found or not confirmed yet. Try again in a few seconds.');
    process.exit(1);
  }

  if (receipt.status !== 'success') {
    console.error(`Source tx REVERTED: ${burnTxHash}`);
    process.exit(1);
  }

  console.log(`✓ Source tx confirmed: block ${receipt.blockNumber}, status: ${receipt.status}`);
  console.log(`  Explorer: ${ARC_TESTNET.explorer}/tx/${burnTxHash}`);

  // 2. Verify MessageSent event was emitted (topic keccak256("MessageSent(bytes)") = known)
  // Topic0 for MessageSent(bytes): 0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036
  const messageSentTopic = '0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036';
  const messageSentLog = receipt.logs.find(
    (l) => l.topics[0]?.toLowerCase() === messageSentTopic && l.address.toLowerCase() === CCTP_V2.messageTransmitter.toLowerCase()
  );

  if (!messageSentLog) {
    // Try TokenMessenger MessageSent too (V2 may emit from Messenger)
    const anyMessageLog = receipt.logs.find((l) => l.topics[0]?.toLowerCase() === messageSentTopic);
    if (!anyMessageLog) {
      console.error('No MessageSent event found in source tx. Verify this is the correct burn tx.');
      console.log('Logs found:', receipt.logs.map(l => ({ addr: l.address, topic0: l.topics[0] })));
      process.exit(1);
    }
    console.log(`✓ MessageSent event found (contract: ${anyMessageLog.address})`);
  } else {
    console.log(`✓ MessageSent event from MessageTransmitterV2`);
  }

  // 3. Poll attestation API
  console.log('\n[2] Polling Circle attestation API...');
  console.log(`    Source domain: ${ARC_TESTNET.cctpDomain}`);
  console.log(`    Tx hash: ${burnTxHash}`);
  console.log('    This can take 1-5 minutes. Polling every 10 seconds...\n');

  const maxAttempts = 60; // 10 minutes max
  let attempt = 0;
  let attestationData: { message: string; attestation: string } | null = null;

  while (attempt < maxAttempts) {
    attempt++;
    const url = `${CCTP_V2.attestationApi}/v2/messages/${ARC_TESTNET.cctpDomain}?transactionHash=${burnTxHash}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) {
          process.stdout.write(`  [${attempt}/${maxAttempts}] Pending (404 — not indexed yet)...\r`);
        } else {
          process.stdout.write(`  [${attempt}/${maxAttempts}] HTTP ${res.status}...\r`);
        }
      } else {
        const data = await res.json() as { messages?: Array<{ status: string; message?: string; attestation?: string }> };
        const msg = data.messages?.[0];

        if (!msg) {
          process.stdout.write(`  [${attempt}/${maxAttempts}] Pending (no messages yet)...\r`);
        } else if (msg.status === 'complete' && msg.attestation && msg.message) {
          console.log(`\n✓ Attestation COMPLETE after ${attempt} attempts (~${attempt * 10}s)`);
          attestationData = { message: msg.message, attestation: msg.attestation };
          break;
        } else {
          process.stdout.write(`  [${attempt}/${maxAttempts}] Status: ${msg.status}...\r`);
        }
      }
    } catch (e) {
      process.stdout.write(`  [${attempt}/${maxAttempts}] Network error: ${String(e).slice(0, 50)}\r`);
    }

    await new Promise((r) => setTimeout(r, 10_000));
  }

  if (!attestationData) {
    console.error('\nAttestation did not complete within polling window. State saved — resume with same command.');
    process.exit(1);
  }

  // Save attestation for receiveMessage step
  const prevState = JSON.parse(stateRaw) as Record<string, unknown>;
  const updatedState: Record<string, unknown> = {
    ...prevState,
    burnTxHash,
    sourceTxBlock: receipt.blockNumber.toString(),
    message: attestationData.message,
    attestation: attestationData.attestation,
    attestedAt: Date.now(),
  };
  await writeFile('/tmp/cctp-e2e-state.json', JSON.stringify(updatedState, null, 2));

  console.log('\nAttestation data saved.');
  console.log('\n══ SIGNATURE 3 of 2+1: receiveMessage (Ethereum Sepolia) ══');
  console.log(`Contract: ${CCTP_V2.messageTransmitter}  (MessageTransmitterV2 on ETH Sepolia)`);
  console.log(`Function: receiveMessage(bytes message, bytes attestation)`);
  console.log(`  message (hex, ${attestationData.message.length / 2 - 1} bytes): ${attestationData.message.slice(0, 20)}...`);
  console.log(`  attestation (hex, ${attestationData.attestation.length / 2 - 1} bytes): ${attestationData.attestation.slice(0, 20)}...`);
  console.log('Chain: Ethereum Sepolia (11155111)');
  console.log('');
  console.log('→ Switch MetaMask to Ethereum Sepolia (chain 11155111).');
  console.log('→ In Veyra Bridge page, click "Receive on Sepolia" to sign receiveMessage.');
  console.log('→ After confirmation, run: bun run scripts/cctp-e2e.ts verify <walletAddress> <receiveTxHash> <burnTxHash>');
  console.log('');
  console.log('message:', attestationData.message);
  console.log('attestation:', attestationData.attestation);
}

// ── Phase 3: Verify destination + generate receipt ───────────────────────────

async function verifyAndReceipt(walletAddress: Address, receiveTxHash: Hash, burnTxHash: Hash) {
  const stateRaw = await readFile('/tmp/cctp-e2e-state.json', 'utf-8').catch(() => null);
  if (!stateRaw) {
    console.error('No state found. Run preflight and attest first.');
    process.exit(1);
  }
  const state = JSON.parse(stateRaw) as {
    sepoliaUsdcBefore: string;
    testAmountRaw: string;
    sourceTxBlock: string;
    burnTxHash: string;
  };

  console.log('\n═══ CCTP V2 Destination Verification ═══');

  const sepoliaClient = makeSepoliaClient();

  // 1. Verify receive tx receipt
  console.log('[1] Verifying receiveMessage tx on Ethereum Sepolia...');
  let receiveReceipt;
  try {
    receiveReceipt = await sepoliaClient.waitForTransactionReceipt({ hash: receiveTxHash, timeout: 30_000 });
  } catch {
    console.error('Receive tx not found or not confirmed yet.');
    process.exit(1);
  }

  if (receiveReceipt.status !== 'success') {
    console.error(`receiveMessage tx REVERTED: ${receiveTxHash}`);
    process.exit(1);
  }
  console.log(`✓ receiveMessage confirmed: block ${receiveReceipt.blockNumber}`);
  console.log(`  Explorer: ${ETH_SEPOLIA.explorer}/tx/${receiveTxHash}`);

  // 2. Read final USDC balance on Sepolia
  const ERC20_BALANCE_ABI = [{
    name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  }] as const;

  const sepoliaUsdcAfter = await sepoliaClient.readContract({
    address: ETH_SEPOLIA.usdc,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [walletAddress],
  });

  const usdcBefore = BigInt(state.sepoliaUsdcBefore);
  const testAmountRaw = BigInt(state.testAmountRaw);
  const delta = sepoliaUsdcAfter - usdcBefore;

  console.log(`\n[2] USDC balance delta on Ethereum Sepolia:`);
  console.log(`  Before:   ${formatUnits(usdcBefore, 6)} USDC`);
  console.log(`  After:    ${formatUnits(sepoliaUsdcAfter, 6)} USDC`);
  console.log(`  Delta:    +${formatUnits(delta, 6)} USDC`);
  console.log(`  Expected: +${formatUnits(testAmountRaw, 6)} USDC`);

  if (delta < testAmountRaw) {
    console.error(`\nVERIFICATION FAILED: delta ${delta} < expected ${testAmountRaw}`);
    process.exit(1);
  }

  console.log(`\n✓ DESTINATION BALANCE VERIFIED: received ${formatUnits(delta, 6)} USDC on Ethereum Sepolia`);

  // 3. Generate VeyraReceipt
  const receiptId = `veyra-cctp-${burnTxHash.slice(2, 18)}-${receiveTxHash.slice(2, 10)}`;
  const receipt = {
    receiptId,
    status: 'VERIFIED',
    actionType: 'BRIDGE',
    providerId: 'cctp-v2-bridge',
    createdAt: Date.now(),
    verifiedAt: Date.now(),
    sourceChainId: ARC_TESTNET.id,
    destinationChainId: ETH_SEPOLIA.id,
    walletAddress,
    amountHuman: formatUnits(delta, 6),
    amountRaw: delta.toString(),
    bridgeTrace: {
      sourceChainId: ARC_TESTNET.id,
      destinationChainId: ETH_SEPOLIA.id,
      sourceTxHash: burnTxHash,
      destinationTxHash: receiveTxHash,
      sourceBlock: Number(state.sourceTxBlock),
      destinationBlock: Number(receiveReceipt.blockNumber),
      bridgeStatus: 'VERIFIED',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    verification: {
      usdcBefore: usdcBefore.toString(),
      usdcAfter: sepoliaUsdcAfter.toString(),
      delta: delta.toString(),
      verified: true,
    },
    provenance: {
      source: 'ONCHAIN_VERIFIED',
      fetchedAt: Date.now(),
      providerId: 'cctp-v2-bridge',
    },
  };

  await writeFile('/tmp/cctp-e2e-receipt.json', JSON.stringify(receipt, null, 2));

  console.log('\n══════════════════════════════════════════');
  console.log('         VEYRA RECEIPT — VERIFIED         ');
  console.log('══════════════════════════════════════════');
  console.log(`Receipt ID:       ${receiptId}`);
  console.log(`Status:           VERIFIED`);
  console.log(`Action:           BRIDGE (CCTP V2)`);
  console.log(`Provider:         cctp-v2-bridge`);
  console.log(`Amount:           ${formatUnits(delta, 6)} USDC`);
  console.log(`Source:           Arc Testnet (${ARC_TESTNET.id})`);
  console.log(`Destination:      Ethereum Sepolia (${ETH_SEPOLIA.id})`);
  console.log(`Source tx:        ${burnTxHash}`);
  console.log(`Destination tx:   ${receiveTxHash}`);
  console.log(`Source block:     ${state.sourceTxBlock}`);
  console.log(`Dest block:       ${receiveReceipt.blockNumber}`);
  console.log(`Verified at:      ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════');
  console.log('\nReceipt saved to /tmp/cctp-e2e-receipt.json');
  console.log('\nNEXT: Promote cctp-v2-bridge to TESTED then ENABLED in providerManifest.ts');
}

// ── Entry point ───────────────────────────────────────────────────────────────

const [,, phase, arg1, arg2, arg3] = process.argv;

if (phase === 'preflight' && arg1) {
  await runPreflight(arg1 as Address);
} else if (phase === 'attest' && arg1) {
  await pollAttestation(arg1 as Hash);
} else if (phase === 'verify' && arg1 && arg2 && arg3) {
  await verifyAndReceipt(arg1 as Address, arg2 as Hash, arg3 as Hash);
} else {
  console.log('Usage:');
  console.log('  bun run scripts/cctp-e2e.ts preflight <walletAddress>');
  console.log('  bun run scripts/cctp-e2e.ts attest <burnTxHash>');
  console.log('  bun run scripts/cctp-e2e.ts verify <walletAddress> <receiveTxHash> <burnTxHash>');
  process.exit(1);
}
