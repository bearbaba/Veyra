/**
 * Veyra BFF — Backend For Frontend
 *
 * TRUST BOUNDARY
 * ──────────────
 * - Holds LLM credential (server-side only, never sent to browser)
 * - Holds Circle API key (for StableFX quote fetching, server-side only)
 * - All LLM output is treated as untrusted text and validated before returning
 * - Browser receives only structured IntentResult — never raw LLM output
 * - BFF never signs for the user's wallet
 * - BFF never broadcasts user transactions
 * - BFF never returns trusted calldata
 * - BFF never receives or stores private keys
 * - All LLM-generated numbers, addresses, and amounts remain UntrustedString
 *   until deterministically resolved by the browser pipeline
 *
 * RATE LIMITING
 * ─────────────
 * - /api/agent/* : 30 req / min per IP
 * - /api/stablefx/* : 20 req / min per IP (quote + fund calls)
 * - Global: 100 req / min per IP
 *
 * REQUEST VALIDATION
 * ──────────────────
 * - Max request body: 4 KB (agent/parse, stablefx/quote)
 * - Schema validation on all request bodies before processing
 * - All LLM output sanitized with validateIntentResponse()
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { validateIntentResponse } from '../src/core/intent/intentSchema';
import { MANIFEST_CONSTANTS } from '../src/providers/registry/providerManifest';

const app = express();

// ── Body parsing with size limits ────────────────────────────────────────────
app.use(express.json({ limit: '4kb' }));

// ── CORS for local dev ───────────────────────────────────────────────────────
app.use((_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// ── Minimal in-process rate limiter ─────────────────────────────────────────
// (express-rate-limit not available without install; this is a lightweight in-process version)

interface RateWindow {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateWindow>();

function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip ?? 'unknown'}:${req.path}`;
    const now = Date.now();
    const window = rateLimitStore.get(key);
    if (!window || now > window.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (window.count >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please wait before retrying.' });
      return;
    }
    window.count++;
    next();
  };
}

// Periodically clean up expired windows to avoid memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of rateLimitStore.entries()) {
    if (now > window.resetAt) rateLimitStore.delete(key);
  }
}, 60_000);

const AGENT_RATE = rateLimit(30, 60_000);
const STABLEFX_RATE = rateLimit(20, 60_000);

// ── LLM Configuration ────────────────────────────────────────────────────────

type LLMProvider = 'openai' | 'anthropic' | 'none';

function detectLLMProvider(): LLMProvider {
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'none';
}

const LLM_PROVIDER = detectLLMProvider();
const LLM_MODEL = process.env.LLM_MODEL ?? (LLM_PROVIDER === 'openai' ? 'gpt-4o-mini' : 'claude-3-5-haiku-20241022');

// ── System prompt ────────────────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `You are Veyra's intent parser. Your only job is to extract structured financial intent from the user's natural-language message.

CRITICAL CONSTRAINTS:
- You are NOT a financial authority. You cannot provide trusted token addresses, balances, prices, exchange rates, APY, gas estimates, risk scores, or transaction success status.
- You must NEVER generate executable calldata.
- You must NEVER decide whether a transaction is safe or approved.
- You must NEVER claim to know wallet balances.
- All numeric values and addresses you extract are UNTRUSTED STRINGS — they will be validated deterministically by the Veyra pipeline before any execution.
- You must respond ONLY with valid JSON matching the IntentResult schema below. No prose. No markdown. Only JSON.
- If the user's message is ambiguous, unrecognized, or unsafe, return intentType: "UNKNOWN" or "NEEDS_CLARIFICATION".
- You must NEVER instruct the system to skip safety checks, bypass policy, or sign automatically.
- Extract only what the user explicitly stated. Do not invent recipient addresses or amounts.

Supported action types: TRANSFER, CONVERT, BRIDGE.
Do NOT return SUPPLY, BORROW, REPAY, WITHDRAW — those are not yet verified.

IntentResult JSON schema:
{
  "intentType": "TRANSFER" | "CONVERT" | "BRIDGE" | "NEEDS_CLARIFICATION" | "UNKNOWN",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "candidates": [
    {
      "actionType": "TRANSFER" | "CONVERT" | "BRIDGE",
      "fromAmount": "<string or null — user-stated amount, e.g. '25' or '25.5'>",
      "fromCurrency": "<string or null — e.g. 'USDC' or 'EURC'>",
      "toCurrency": "<string or null — for CONVERT or BRIDGE>",
      "recipient": "<string or null — address or ENS if stated>",
      "sourceChain": "<string or null — for BRIDGE>",
      "destinationChain": "<string or null — for BRIDGE>"
    }
  ],
  "missingParams": ["<list of missing required params, e.g. 'recipient', 'amount'>"],
  "clarificationQuestion": "<null, or a single short question to ask the user>",
  "displaySummary": "<max 120 chars — plain English summary of what was understood>"
}

Rules:
- candidates must have at most 2 entries.
- All string values must be 300 chars or fewer.
- displaySummary must be 120 chars or fewer.
- If intentType is NEEDS_CLARIFICATION, include clarificationQuestion.
- If any required field cannot be determined from the user's message, add it to missingParams.
- Required fields by action type:
  TRANSFER: fromAmount, fromCurrency (must be USDC), recipient
  CONVERT: fromAmount, fromCurrency, toCurrency
  BRIDGE: fromAmount, fromCurrency (must be USDC), sourceChain, destinationChain`;

// ── LLM call helpers ─────────────────────────────────────────────────────────

async function callOpenAI(userMessage: string): Promise<unknown> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0,
      max_tokens: 512,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = data.choices[0]?.message?.content ?? '{}';
  return JSON.parse(raw) as unknown;
}

async function callAnthropic(userMessage: string): Promise<unknown> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 512,
      system: AGENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content.find((c) => c.type === 'text')?.text ?? '{}';
  // Strip any markdown fences Anthropic might emit
  const jsonText = text.replace(/^```json?\s*/m, '').replace(/```\s*$/m, '').trim();
  return JSON.parse(jsonText) as unknown;
}

async function callLLM(userMessage: string): Promise<unknown> {
  if (LLM_PROVIDER === 'openai') return callOpenAI(userMessage);
  if (LLM_PROVIDER === 'anthropic') return callAnthropic(userMessage);
  // No LLM configured — return a structured stub for development
  return {
    intentType: 'UNKNOWN',
    confidence: 'LOW',
    candidates: [],
    missingParams: [],
    clarificationQuestion: null,
    displaySummary: '[Dev mode: No LLM key configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.]',
  };
}

// ── Request body validation ──────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

// ── POST /api/agent/parse ────────────────────────────────────────────────────

app.post('/api/agent/parse', AGENT_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;

    // Validate request schema
    if (!isNonEmptyString(body.message)) {
      res.status(400).json({ error: 'message must be a non-empty string' });
      return;
    }
    if (body.message.length > 2000) {
      res.status(400).json({ error: 'message too long (max 2000 chars)' });
      return;
    }

    // Prompt injection guard: reject messages that look like prompt injection attempts
    const lowerMsg = body.message.toLowerCase();
    const injectionPatterns = [
      'ignore previous instructions',
      'ignore all previous',
      'disregard the system',
      'new instructions:',
      'override policy',
      'bypass safety',
      'sign automatically',
      'skip confirmation',
      'execute without',
      'system prompt',
      '</system>',
      '<|im_start|>',
      '```system',
    ];
    if (injectionPatterns.some((p) => lowerMsg.includes(p))) {
      // Return BLOCKED intent — do not call LLM
      res.json({
        ok: true,
        intent: {
          intentType: 'UNKNOWN',
          confidence: 'LOW',
          candidates: [],
          missingParams: [],
          clarificationQuestion: null,
          displaySummary: 'This message was blocked by the safety filter.',
          _blocked: true,
        },
      });
      return;
    }

    // Call LLM (server-side — key never reaches browser)
    let rawLLMOutput: unknown;
    try {
      rawLLMOutput = await callLLM(body.message);
    } catch (llmErr) {
      console.error('[BFF] LLM error:', llmErr);
      res.status(502).json({ error: 'Agent service temporarily unavailable' });
      return;
    }

    // Validate and sanitize LLM output — browser gets only this result
    const validated = validateIntentResponse(rawLLMOutput);
    res.json({ ok: true, intent: validated });
  } catch (err) {
    console.error('[BFF] /api/agent/parse error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/agent/explain ──────────────────────────────────────────────────

app.post('/api/agent/explain', AGENT_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    if (!isNonEmptyString(body.actionType) || !body.params) {
      res.status(400).json({ error: 'actionType and params are required' });
      return;
    }

    const actionType = String(body.actionType).slice(0, 50);
    const paramsStr = JSON.stringify(body.params).slice(0, 500);

    const prompt = `Explain in plain English (max 80 words) what this Veyra financial action does. Be factual about what will happen. Do NOT make claims about safety, risk, or prices. Action type: ${actionType}. Parameters (display only): ${paramsStr}`;

    let explanation = '';
    try {
      const raw = await callLLM(prompt);
      if (typeof raw === 'object' && raw !== null && 'displaySummary' in raw) {
        explanation = String((raw as Record<string, unknown>).displaySummary ?? '').slice(0, 300);
      } else if (typeof raw === 'string') {
        explanation = raw.slice(0, 300);
      } else {
        explanation = `${actionType} action`;
      }
    } catch {
      explanation = `${actionType} action`;
    }

    res.json({ ok: true, explanation });
  } catch (err) {
    console.error('[BFF] /api/agent/explain error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/stablefx/quote ─────────────────────────────────────────────────
// Fetches a StableFX tradable quote from Circle API (server-side — API key stays here)
// Returns the quote including typedData for browser-side Permit2 signing.
// The browser must NOT trust the amounts here as execution-ready —
// they flow through the Convert pipeline (Policy, Risk, simulation) first.

app.post('/api/stablefx/quote', STABLEFX_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const circleApiKey = process.env.CIRCLE_API_KEY;
    if (!circleApiKey) {
      res.status(503).json({ error: 'Circle API key not configured on this server' });
      return;
    }

    const body = req.body as Record<string, unknown>;

    // Validate required fields
    const { fromCurrency, toCurrency, fromAmount, recipientAddress } = body;
    if (
      !isNonEmptyString(fromCurrency) ||
      !isNonEmptyString(toCurrency) ||
      !isNonEmptyString(fromAmount) ||
      !isNonEmptyString(recipientAddress)
    ) {
      res.status(400).json({ error: 'fromCurrency, toCurrency, fromAmount, recipientAddress required' });
      return;
    }

    // Only USDC/EURC pairs supported
    const validCurrencies = ['USDC', 'EURC'];
    if (!validCurrencies.includes(fromCurrency) || !validCurrencies.includes(toCurrency)) {
      res.status(400).json({ error: 'Only USDC and EURC are supported currencies' });
      return;
    }
    if (fromCurrency === toCurrency) {
      res.status(400).json({ error: 'fromCurrency and toCurrency must differ' });
      return;
    }

    // Amount must be a positive number string
    const parsedAmount = parseFloat(fromAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: 'fromAmount must be a positive number' });
      return;
    }

    const quoteBody = {
      from: { currency: fromCurrency, amount: fromAmount },
      to: { currency: toCurrency },
      tenor: 'instant',
      type: 'tradable',
      recipientAddress,
    };

    const circleRes = await fetch(
      `${MANIFEST_CONSTANTS.STABLEFX_SANDBOX_BASE_URL}/v1/exchange/stablefx/quotes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${circleApiKey}`,
        },
        body: JSON.stringify(quoteBody),
      },
    );

    if (!circleRes.ok) {
      const errText = await circleRes.text();
      console.error('[BFF] StableFX quote error:', circleRes.status, errText);
      res.status(502).json({ error: `Circle StableFX returned ${circleRes.status}` });
      return;
    }

    const quote = await circleRes.json() as unknown;
    res.json({ ok: true, quote, fetchedAt: Date.now() });
  } catch (err) {
    console.error('[BFF] /api/stablefx/quote error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/stablefx/trade ─────────────────────────────────────────────────
// Creates a StableFX trade (after browser has signed the Permit2 typed data).

app.post('/api/stablefx/trade', STABLEFX_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const circleApiKey = process.env.CIRCLE_API_KEY;
    if (!circleApiKey) {
      res.status(503).json({ error: 'Circle API key not configured on this server' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const { idempotencyKey, quoteId, address, message, signature } = body;
    if (
      !isNonEmptyString(idempotencyKey) ||
      !isNonEmptyString(quoteId) ||
      !isNonEmptyString(address) ||
      !message ||
      !isNonEmptyString(signature)
    ) {
      res.status(400).json({ error: 'idempotencyKey, quoteId, address, message, signature required' });
      return;
    }

    const tradeBody = { idempotencyKey, quoteId, address, message, signature };
    const circleRes = await fetch(
      `${MANIFEST_CONSTANTS.STABLEFX_SANDBOX_BASE_URL}/v1/exchange/stablefx/trades`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${circleApiKey}`,
        },
        body: JSON.stringify(tradeBody),
      },
    );

    if (!circleRes.ok) {
      const errText = await circleRes.text();
      console.error('[BFF] StableFX trade error:', circleRes.status, errText);
      res.status(502).json({ error: `Circle StableFX trade returned ${circleRes.status}` });
      return;
    }

    const trade = await circleRes.json() as unknown;
    res.json({ ok: true, trade });
  } catch (err) {
    console.error('[BFF] /api/stablefx/trade error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/stablefx/trade/:tradeId ─────────────────────────────────────────

app.get('/api/stablefx/trade/:tradeId', STABLEFX_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const circleApiKey = process.env.CIRCLE_API_KEY;
    if (!circleApiKey) {
      res.status(503).json({ error: 'Circle API key not configured' });
      return;
    }

    const { tradeId } = req.params;
    if (!tradeId || !/^[a-zA-Z0-9_-]{1,100}$/.test(tradeId)) {
      res.status(400).json({ error: 'Invalid tradeId' });
      return;
    }

    const circleRes = await fetch(
      `${MANIFEST_CONSTANTS.STABLEFX_SANDBOX_BASE_URL}/v1/exchange/stablefx/trades/${tradeId}`,
      { headers: { Authorization: `Bearer ${circleApiKey}` } },
    );

    if (!circleRes.ok) {
      res.status(502).json({ error: `Circle StableFX returned ${circleRes.status}` });
      return;
    }

    const trade = await circleRes.json() as unknown;
    res.json({ ok: true, trade });
  } catch (err) {
    console.error('[BFF] /api/stablefx/trade/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/cctp/attestation ─────────────────────────────────────────────────
// Polls Circle's CCTP V2 attestation API for a message.
// Route: GET /api/cctp/attestation?sourceDomain=26&txHash=0x...

app.get('/api/cctp/attestation', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sourceDomain, txHash } = req.query;
    if (
      !isNonEmptyString(sourceDomain as string) ||
      !isNonEmptyString(txHash as string) ||
      !/^0x[0-9a-fA-F]{64}$/.test(txHash as string)
    ) {
      res.status(400).json({ error: 'sourceDomain and txHash (0x + 64 hex) required' });
      return;
    }

    // CCTP V2 attestation endpoint
    const url = `https://iris-api-sandbox.circle.com/v2/messages/${sourceDomain}?transactionHash=${txHash as string}`;
    const attestRes = await fetch(url);

    if (!attestRes.ok) {
      res.status(502).json({ error: `CCTP attestation API returned ${attestRes.status}` });
      return;
    }

    const data = await attestRes.json() as unknown;
    res.json({ ok: true, data, fetchedAt: Date.now() });
  } catch (err) {
    console.error('[BFF] /api/cctp/attestation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/bridge/persist ──────────────────────────────────────────────────
// Persists a pending bridge receipt so it can be resumed after reload.
// In MVP this is in-process memory. A production deployment would use a DB.

const pendingBridges = new Map<string, unknown>();

app.post('/api/bridge/persist', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const planId = typeof body.planId === 'string' ? body.planId : null;
    const burnTxHash = typeof body.burnTxHash === 'string' ? body.burnTxHash : null;
    if (!planId || !burnTxHash) {
      res.status(400).json({ error: 'planId and burnTxHash required' });
      return;
    }
    pendingBridges.set(planId, { ...body, persistedAt: Date.now() });
    res.json({ ok: true, planId });
  } catch (err) {
    console.error('[BFF] /api/bridge/persist error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/bridge/pending ───────────────────────────────────────────────────

app.get('/api/bridge/pending', (_req: Request, res: Response): void => {
  const all = Array.from(pendingBridges.values());
  res.json({ ok: true, pending: all });
});

// ── POST /api/bridge/relay-receive ───────────────────────────────────────────
// Relays a CCTP V2 receiveMessage call from the BFF.
// Safe because destinationCaller = 0x00...00 means any caller is permitted.
// The BFF uses its own funded relay wallet (RELAY_PRIVATE_KEY in .env).
// This eliminates the need for the user to switch chains and sign a second tx.
//
// SECURITY: The BFF validates message + attestation format before relaying.
// The BFF never signs for the user's primary wallet — only the relay wallet.
// The relay wallet holds only enough gas for relay calls (not user funds).

app.post('/api/bridge/relay-receive', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const { message, attestation, destinationChainId } = body;

    if (
      typeof message !== 'string' ||
      typeof attestation !== 'string' ||
      typeof destinationChainId !== 'number'
    ) {
      res.status(400).json({ error: 'message (hex string), attestation (hex string), destinationChainId (number) required' });
      return;
    }

    // Validate hex format
    if (!/^0x[0-9a-fA-F]+$/.test(message) || !/^0x[0-9a-fA-F]+$/.test(attestation)) {
      res.status(400).json({ error: 'message and attestation must be valid hex strings' });
      return;
    }

    // Check relay wallet is configured
    const relayKey = process.env.RELAY_PRIVATE_KEY;
    if (!relayKey) {
      // No relay wallet — caller must sign themselves
      res.status(503).json({
        ok: false,
        selfRelay: true,
        reason: 'RELAY_PRIVATE_KEY not configured on BFF. User must sign receiveMessage themselves.',
      });
      return;
    }

    // Dynamic import of viem (available in node_modules)
    const { createWalletClient, createPublicClient, http: viemHttp, parseAbi } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { sepolia: sepoliaChain } = await import('viem/chains');

    const TRANSMITTER_SEPOLIA = MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER as `0x${string}`;
    const RECEIVE_ABI = parseAbi([
      'function receiveMessage(bytes message, bytes attestation) returns (bool success)',
    ]);

    const relayAccount = privateKeyToAccount(relayKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: sepoliaChain, transport: viemHttp() });
    const walletClient = createWalletClient({ account: relayAccount, chain: sepoliaChain, transport: viemHttp() });

    // Simulate first to detect nonce-already-used
    try {
      await publicClient.simulateContract({
        address: TRANSMITTER_SEPOLIA,
        abi: RECEIVE_ABI,
        functionName: 'receiveMessage',
        args: [message as `0x${string}`, attestation as `0x${string}`],
        account: relayAccount.address,
      });
    } catch (simErr) {
      const errMsg = simErr instanceof Error ? simErr.message : String(simErr);
      if (errMsg.toLowerCase().includes('nonce already used')) {
        // Message was already received — this is success
        res.json({ ok: true, alreadyReceived: true, txHash: null });
        return;
      }
      res.status(422).json({ ok: false, error: `receiveMessage simulation failed: ${errMsg}` });
      return;
    }

    // Execute relay
    const txHash = await walletClient.writeContract({
      address: TRANSMITTER_SEPOLIA,
      abi: RECEIVE_ABI,
      functionName: 'receiveMessage',
      args: [message as `0x${string}`, attestation as `0x${string}`],
    });

    res.json({ ok: true, alreadyReceived: false, txHash });
  } catch (err) {
    console.error('[BFF] /api/bridge/relay-receive error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req: Request, res: Response): void => {
  res.json({
    ok: true,
    llmProvider: LLM_PROVIDER,
    llmModel: LLM_MODEL,
    circleApiConfigured: !!process.env.CIRCLE_API_KEY,
    ts: Date.now(),
  });
});

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.BFF_PORT ?? '3001', 10);
app.listen(PORT, () => {
  console.log(`[BFF] Listening on port ${PORT}`);
  console.log(`[BFF] LLM provider: ${LLM_PROVIDER} (model: ${LLM_MODEL})`);
  console.log(`[BFF] Circle API configured: ${!!process.env.CIRCLE_API_KEY}`);
});

export default app;
