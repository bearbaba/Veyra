-- StableFX owner-bound trade attempts, fail closed on uncertain provider submission.
-- Apply only to a backed-up Testnet PostgreSQL database, never to Mainnet.
CREATE TABLE IF NOT EXISTS stablefx_quote_bindings (
 quote_id text PRIMARY KEY,
 owner_user_id text NOT NULL REFERENCES veyra_users(veyr_user_id),
 wallet_address text NOT NULL,
 from_currency text NOT NULL CHECK (from_currency IN ('USDC','EURC')),
 to_currency text NOT NULL CHECK (to_currency IN ('USDC','EURC') AND to_currency <> from_currency),
 input_amount text NOT NULL,
 signed_typed_data jsonb NOT NULL,
 expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'AVAILABLE' CHECK (state IN ('AVAILABLE','CLAIMED')),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stablefx_quote_owner ON stablefx_quote_bindings(owner_user_id,created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS stablefx_trade_attempts (
 idempotency_key text PRIMARY KEY,
 quote_id text NOT NULL UNIQUE REFERENCES stablefx_quote_bindings(quote_id),
 owner_user_id text NOT NULL REFERENCES veyra_users(veyr_user_id),
 wallet_address text NOT NULL,
 trade_id text UNIQUE,
 contract_trade_id text,
 state text NOT NULL CHECK (state IN ('SUBMITTING','TRADE_CREATED','SUBMISSION_UNKNOWN','FUNDING_READY','FUNDING_SUBMITTING','FUNDING_SENT')),
 funding_typed_data jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stablefx_trade_owner ON stablefx_trade_attempts(owner_user_id,updated_at DESC);
