CREATE TYPE "public"."proof_challenge_status" AS ENUM('ISSUED', 'CONSUMED', 'EXPIRED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "proof_challenges" (
  "challenge_id" text PRIMARY KEY NOT NULL,
  "veyr_user_id" text NOT NULL,
  "wallet_address" text NOT NULL,
  "chain_id" bigint NOT NULL,
  "proof_scheme" "wallet_proof_scheme" NOT NULL,
  "proof_version" text NOT NULL,
  "nonce" text NOT NULL,
  "typed_data" jsonb,
  "plain_message" text NOT NULL,
  "message_hash" text NOT NULL,
  "issued_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "status" "proof_challenge_status" DEFAULT 'ISSUED' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proof_challenges" ADD CONSTRAINT "proof_challenges_veyr_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("veyr_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_proof_challenges_user_issued" ON "proof_challenges" USING btree ("veyr_user_id","issued_at");--> statement-breakpoint
CREATE INDEX "ix_proof_challenges_wallet_chain" ON "proof_challenges" USING btree ("wallet_address","chain_id");--> statement-breakpoint
CREATE INDEX "ix_proof_challenges_expiry" ON "proof_challenges" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uix_proof_challenges_active_wallet" ON "proof_challenges" (LOWER("wallet_address"), "chain_id", "veyr_user_id") WHERE status = 'ISSUED' AND consumed_at IS NULL;--> statement-breakpoint
ALTER TABLE "proof_challenges" ADD CONSTRAINT "chk_proof_challenges_expiry_after_issue" CHECK (expires_at > issued_at);--> statement-breakpoint
