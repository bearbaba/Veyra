/**
 * TESTNET-only StableFX ownership and submission state.
 * These checks are backed by PostgreSQL, not process memory, cookies or sessionStorage.
 * No API route may fund a trade merely because *some* Veyra ID is logged in.
 */
import { sql } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';

export interface BoundStableFxQuote {
  quoteId:string;
  userId:string;
  walletAddress:string;
  fromCurrency:'USDC'|'EURC';
  toCurrency:'USDC'|'EURC';
  fromAmount:string;
  typedData:Record<string,unknown>;
  expiresAt:string;
}
export interface BoundStableFxTrade {
  tradeId:string;
  contractTradeId:string;
  userId:string;
  walletAddress:string;
  quoteId:string;
  state:string;
}
export class StableFxOwnershipError extends Error {
  constructor(public readonly code:string){super(code);}
}
export async function assertVerifiedStableFxWallet(
 db:DbClient,userId:string,walletAddress:string,
):Promise<void>{
 const rows=await db.execute(sql`
   SELECT 1 FROM wallet_bindings wb
   JOIN veyra_users u ON u.veyr_user_id=wb.veyr_user_id
   WHERE wb.veyr_user_id=${userId}
     AND lower(wb.wallet_address)=lower(${walletAddress})
     AND wb.chain_id=5042002
     AND wb.status='ACTIVE' AND wb.revoked_at IS NULL
     AND u.status='ACTIVE' AND u.deleted_at IS NULL LIMIT 1
 `);
 if(rows.rows.length!==1)throw new StableFxOwnershipError('STABLEFX_WALLET_NOT_BOUND_TO_SESSION');
}
export async function saveBoundStableFxQuote(db:DbClient,q:BoundStableFxQuote):Promise<void>{
 await assertVerifiedStableFxWallet(db,q.userId,q.walletAddress);
 const result=await db.execute(sql`
  INSERT INTO stablefx_quote_bindings
   (quote_id,owner_user_id,wallet_address,from_currency,to_currency,input_amount,signed_typed_data,expires_at)
  VALUES (${q.quoteId},${q.userId},lower(${q.walletAddress}),${q.fromCurrency},
    ${q.toCurrency},${q.fromAmount},${JSON.stringify(q.typedData)}::jsonb,${q.expiresAt}::timestamptz)
  ON CONFLICT DO NOTHING RETURNING quote_id
 `);
 if(result.rows.length!==1) throw new StableFxOwnershipError('STABLEFX_QUOTE_ALREADY_RECORDED');
}
export async function reserveStableFxTrade(
 db:DbClient,input:{quoteId:string;idempotencyKey:string;userId:string;walletAddress:string;message:unknown},
):Promise<void>{
 await assertVerifiedStableFxWallet(db,input.userId,input.walletAddress);
 const attempt=await db.execute(sql`
   WITH reserved AS (
    UPDATE stablefx_quote_bindings SET state='CLAIMED'
    WHERE quote_id=${input.quoteId} AND owner_user_id=${input.userId}
     AND lower(wallet_address)=lower(${input.walletAddress})
     AND expires_at>now() + interval '20 seconds'
     AND signed_typed_data->'message'=${JSON.stringify(input.message)}::jsonb
     AND state='AVAILABLE'
    RETURNING quote_id
   )
   INSERT INTO stablefx_trade_attempts
   (idempotency_key,quote_id,owner_user_id,wallet_address,state)
   SELECT ${input.idempotencyKey},quote_id,${input.userId},lower(${input.walletAddress}),'SUBMITTING'
   FROM reserved
   ON CONFLICT DO NOTHING RETURNING idempotency_key
 `);
 if(attempt.rows.length!==1)throw new StableFxOwnershipError('STABLEFX_QUOTE_NOT_OWNED_STALE_OR_ALREADY_SUBMITTED');
}
export async function recordStableFxTrade(
 db:DbClient,input:{idempotencyKey:string;userId:string;tradeId:string;contractTradeId:string},
):Promise<void>{
 const result=await db.execute(sql`
  UPDATE stablefx_trade_attempts SET trade_id=${input.tradeId},
   contract_trade_id=${input.contractTradeId},state='TRADE_CREATED',updated_at=now()
  WHERE idempotency_key=${input.idempotencyKey} AND owner_user_id=${input.userId}
   AND state='SUBMITTING'
  RETURNING idempotency_key
 `);
 if(result.rows.length!==1)throw new StableFxOwnershipError('STABLEFX_TRADE_RECONCILIATION_REQUIRED');
}
export async function markStableFxTradeUncertain(db:DbClient,key:string,userId:string):Promise<void>{
 await db.execute(sql`
  UPDATE stablefx_trade_attempts SET state='SUBMISSION_UNKNOWN',updated_at=now()
  WHERE idempotency_key=${key} AND owner_user_id=${userId} AND state='SUBMITTING'
 `);
}
export async function requireOwnedStableFxTrade(
 db:DbClient,input:{userId:string;tradeId:string;contractTradeId?:string},
):Promise<BoundStableFxTrade>{
 const rows=await db.execute(sql`
  SELECT trade_id AS "tradeId",contract_trade_id AS "contractTradeId",
   owner_user_id AS "userId",wallet_address AS "walletAddress",
   quote_id AS "quoteId",state
  FROM stablefx_trade_attempts
  WHERE owner_user_id=${input.userId} AND trade_id=${input.tradeId}
  LIMIT 1
 `);
 const row=rows.rows[0] as Record<string,unknown>|undefined;
 if(!row||typeof row.tradeId!=='string'||typeof row.contractTradeId!=='string'||
  (input.contractTradeId!==undefined&&row.contractTradeId!==input.contractTradeId))
   throw new StableFxOwnershipError('STABLEFX_TRADE_NOT_OWNED');
 const result:BoundStableFxTrade={tradeId:row.tradeId,contractTradeId:row.contractTradeId,
  userId:String(row.userId),walletAddress:String(row.walletAddress),
  quoteId:String(row.quoteId),state:String(row.state)};
 await assertVerifiedStableFxWallet(db,input.userId,result.walletAddress);
 return result;
}
export async function saveStableFxFundingPresign(
 db:DbClient,input:{userId:string;tradeId:string;payload:unknown},
):Promise<void>{
 const result=await db.execute(sql`
  UPDATE stablefx_trade_attempts SET funding_typed_data=${JSON.stringify(input.payload)}::jsonb,
   state='FUNDING_READY',updated_at=now()
  WHERE owner_user_id=${input.userId} AND trade_id=${input.tradeId}
   AND state IN ('TRADE_CREATED','FUNDING_READY') RETURNING trade_id
 `);
 if(result.rows.length!==1)throw new StableFxOwnershipError('STABLEFX_FUNDING_NOT_READY');
}
export async function claimStableFxFundingSubmission(
 db:DbClient,input:{userId:string;tradeId:string;message:unknown},
):Promise<void>{
 const result=await db.execute(sql`
  UPDATE stablefx_trade_attempts SET state='FUNDING_SUBMITTING',updated_at=now()
  WHERE owner_user_id=${input.userId} AND trade_id=${input.tradeId}
   AND state='FUNDING_READY'
   AND funding_typed_data->'message'=${JSON.stringify(input.message)}::jsonb
  RETURNING trade_id
 `);
 if(result.rows.length!==1)throw new StableFxOwnershipError('STABLEFX_FUNDING_ALREADY_SUBMITTED_OR_MISMATCHED');
}
export async function markStableFxFundingSent(db:DbClient,userId:string,tradeId:string):Promise<void>{
 await db.execute(sql`
  UPDATE stablefx_trade_attempts SET state='FUNDING_SENT',updated_at=now()
  WHERE owner_user_id=${userId} AND trade_id=${tradeId} AND state='FUNDING_SUBMITTING'
 `);
}
