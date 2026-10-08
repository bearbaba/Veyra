CREATE TYPE "public"."block_status" AS ENUM('BLOCKED', 'UNBLOCKED');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('PENDING_INITIATOR', 'PENDING_TARGET', 'CONNECTED', 'REJECTED', 'DISCONNECTED');--> statement-breakpoint
CREATE TYPE "public"."execution_event_type" AS ENUM('INTENT_CAPTURED', 'QUOTE_RESERVED', 'PREFLIGHT_CHECK', 'SNAPSHOT_FROZEN', 'SNAPSHOT_VERIFIED', 'SNAPSHOT_INVALIDATED', 'POLICY_EVALUATED', 'USER_CONFIRMED', 'BURN_SUBMITTED', 'BURN_CONFIRMED', 'ATTESTATION_REQUESTED', 'ATTESTATION_COMPLETE', 'RELAY_SUBMITTED', 'RELAY_CONFIRMED', 'RECEIVE_SUBMITTED', 'RECEIVE_CONFIRMED', 'RECEIVE_FAILED', 'RECEIPT_COMPLETE', 'RECEIPT_FAILED', 'DUPLICATE_REJECTED');--> statement-breakpoint
CREATE TYPE "public"."follow_status" AS ENUM('FOLLOWING', 'UNFOLLOWED');--> statement-breakpoint
CREATE TYPE "public"."intent_status" AS ENUM('PENDING', 'RESOLVED', 'POLICY_BLOCKED', 'CANCELLED', 'EXECUTED');--> statement-breakpoint
CREATE TYPE "public"."intent_surface" AS ENUM('PAY', 'AGENT', 'BRIDGE', 'REQUEST');--> statement-breakpoint
CREATE TYPE "public"."linked_identity_provider" AS ENUM('X', 'ENS', 'FARCASTER');--> statement-breakpoint
CREATE TYPE "public"."linked_identity_status" AS ENUM('ACTIVE', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."post_interaction_type" AS ENUM('LIKE', 'REPLY', 'REPOST', 'TIP');--> statement-breakpoint
CREATE TYPE "public"."post_visibility" AS ENUM('PUBLIC', 'FOLLOWERS_ONLY', 'PRIVATE');--> statement-breakpoint
CREATE TYPE "public"."preference_visibility" AS ENUM('PUBLIC', 'FRIENDS_ONLY', 'PRIVATE');--> statement-breakpoint
CREATE TYPE "public"."profile_source" AS ENUM('VEYRA', 'X_IMPORT');--> statement-breakpoint
CREATE TYPE "public"."profile_visibility" AS ENUM('PUBLIC', 'FOLLOWERS_ONLY', 'PRIVATE');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('AVAILABLE', 'RESERVED', 'BROADCAST', 'USED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('INTENT_CAPTURED', 'QUOTE_RESERVED', 'PREFLIGHT_PASSED', 'SIGNED', 'BROADCAST', 'CONFIRMING', 'CONFIRMED', 'FAILED', 'RECEIVE_PENDING', 'RECEIVE_FAILED_RETRYABLE', 'COMPLETE', 'DUPLICATE_DETECTED', 'INVALIDATED');--> statement-breakpoint
CREATE TYPE "public"."revision_trigger" AS ENUM('WALLET_ADDED', 'WALLET_REVOKED', 'RECEIVE_PREFERENCE_CHANGED', 'LINKED_IDENTITY_ADDED', 'LINKED_IDENTITY_REVOKED', 'HANDLE_CHANGED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_RESTORED');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'SUSPENDED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."wallet_proof_scheme" AS ENUM('EIP_712', 'PERSONAL_SIGN');--> statement-breakpoint
CREATE TYPE "public"."wallet_status" AS ENUM('ACTIVE', 'REVOKED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."wallet_type" AS ENUM('EOA', 'SCA', 'MODULAR');--> statement-breakpoint
CREATE TABLE "handle_history" (
	"handle_history_id" text PRIMARY KEY NOT NULL,
	"veyr_user_id" text NOT NULL,
	"handle" text NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone NOT NULL,
	"reserved_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linked_identities" (
	"linked_identity_id" text PRIMARY KEY NOT NULL,
	"veyr_user_id" text NOT NULL,
	"provider" "linked_identity_provider" NOT NULL,
	"external_id" text NOT NULL,
	"external_handle" text,
	"external_display_name" text,
	"external_avatar_url" text,
	"external_bio" text,
	"external_metadata" jsonb,
	"status" "linked_identity_status" DEFAULT 'ACTIVE' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "veyra_users" (
	"veyr_user_id" text PRIMARY KEY NOT NULL,
	"veyr_handle" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"bio" text DEFAULT '' NOT NULL,
	"profile_visibility" "profile_visibility" DEFAULT 'PUBLIC' NOT NULL,
	"avatar_source" "profile_source" DEFAULT 'VEYRA' NOT NULL,
	"display_name_source" "profile_source" DEFAULT 'VEYRA' NOT NULL,
	"bio_source" "profile_source" DEFAULT 'VEYRA' NOT NULL,
	"identity_revision" bigint DEFAULT 1 NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallet_bindings" (
	"wallet_id" text PRIMARY KEY NOT NULL,
	"veyr_user_id" text NOT NULL,
	"wallet_address" text NOT NULL,
	"chain_id" bigint NOT NULL,
	"wallet_type" "wallet_type" DEFAULT 'EOA' NOT NULL,
	"proof_scheme" "wallet_proof_scheme" NOT NULL,
	"proof_version" text NOT NULL,
	"proof_challenge_id" text NOT NULL,
	"proof_nonce" text NOT NULL,
	"proof_signature" text NOT NULL,
	"proof_message_hash" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"status" "wallet_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_snapshots" (
	"snapshot_id" text PRIMARY KEY NOT NULL,
	"veyr_user_id" text NOT NULL,
	"veyr_handle" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"identity_revision" bigint NOT NULL,
	"resolved_wallets" jsonb NOT NULL,
	"receive_preference" jsonb NOT NULL,
	"frozen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" text
);
--> statement-breakpoint
CREATE TABLE "receive_preferences" (
	"preference_id" text PRIMARY KEY NOT NULL,
	"veyr_user_id" text NOT NULL,
	"preferred_token_id" text DEFAULT 'usdc' NOT NULL,
	"preferred_chain_id" bigint NOT NULL,
	"primary_wallet_id" text NOT NULL,
	"alternative_routes" jsonb NOT NULL,
	"visibility" "preference_visibility" DEFAULT 'FRIENDS_ONLY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receive_preferences_veyr_user_id_unique" UNIQUE("veyr_user_id")
);
--> statement-breakpoint
CREATE TABLE "social_blocks" (
	"block_id" text PRIMARY KEY NOT NULL,
	"blocker_user_id" text NOT NULL,
	"blocked_user_id" text NOT NULL,
	"status" "block_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_connections" (
	"connection_id" text PRIMARY KEY NOT NULL,
	"user_a_id" text NOT NULL,
	"user_b_id" text NOT NULL,
	"initiator_user_id" text NOT NULL,
	"status" "connection_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_follows" (
	"follow_id" text PRIMARY KEY NOT NULL,
	"follower_user_id" text NOT NULL,
	"followee_user_id" text NOT NULL,
	"status" "follow_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_receipts" (
	"receipt_id" text PRIMARY KEY NOT NULL,
	"client_intent_id" text NOT NULL,
	"sender_user_id" text NOT NULL,
	"sender_wallet_id" text NOT NULL,
	"sender_address" text NOT NULL,
	"sender_chain_id" bigint NOT NULL,
	"recipient_snapshot_id" text NOT NULL,
	"recipient_address" text NOT NULL,
	"recipient_chain_id" bigint NOT NULL,
	"amount_raw" numeric(38, 0) NOT NULL,
	"amount_decimals" integer NOT NULL,
	"asset_id" text NOT NULL,
	"token_address" text NOT NULL,
	"provider_id" text NOT NULL,
	"route_id" text NOT NULL,
	"quote_id" text,
	"dedup_key" text NOT NULL,
	"burn_tx_hash" text,
	"burn_chain_id" bigint,
	"burn_block_number" bigint,
	"message_hash" text,
	"message_bytes" text,
	"attestation_nonce" text,
	"receive_tx_hash" text,
	"receive_chain_id" bigint,
	"receive_block_number" bigint,
	"environment" text DEFAULT 'testnet' NOT NULL,
	"status" "receipt_status" DEFAULT 'INTENT_CAPTURED' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	CONSTRAINT "activity_receipts_client_intent_id_unique" UNIQUE("client_intent_id"),
	CONSTRAINT "activity_receipts_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
CREATE TABLE "execution_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"event_type" "execution_event_type" NOT NULL,
	"actor" text,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_revisions" (
	"revision_id" text PRIMARY KEY NOT NULL,
	"veyr_user_id" text NOT NULL,
	"revision_number" bigint NOT NULL,
	"trigger" "revision_trigger" NOT NULL,
	"detail" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intents" (
	"intent_id" text PRIMARY KEY NOT NULL,
	"client_intent_id" text NOT NULL,
	"veyr_user_id" text NOT NULL,
	"surface" "intent_surface" NOT NULL,
	"raw_input" text,
	"parsed_action" jsonb NOT NULL,
	"recipient_input" text,
	"amount_raw" numeric(38, 0),
	"asset_id" text,
	"status" "intent_status" DEFAULT 'PENDING' NOT NULL,
	"receipt_id" text,
	"policy_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intents_client_intent_id_unique" UNIQUE("client_intent_id")
);
--> statement-breakpoint
CREATE TABLE "route_quotes" (
	"quote_id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"route_id" text NOT NULL,
	"source_chain_id" bigint NOT NULL,
	"destination_chain_id" bigint NOT NULL,
	"source_token" text NOT NULL,
	"destination_token" text NOT NULL,
	"amount_in_raw" numeric(38, 0) NOT NULL,
	"amount_out_raw" numeric(38, 0) NOT NULL,
	"fee_raw" numeric(38, 0) NOT NULL,
	"fee_token" text NOT NULL,
	"estimated_arrival_s" integer NOT NULL,
	"provider_expires_at" timestamp with time zone NOT NULL,
	"veyra_ttl_expires_at" timestamp with time zone NOT NULL,
	"status" "quote_status" DEFAULT 'AVAILABLE' NOT NULL,
	"raw_quote" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_interactions" (
	"interaction_id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"interaction_type" "post_interaction_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "post_tips" (
	"tip_id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"sender_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_tips_receipt_id_unique" UNIQUE("receipt_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"post_id" text PRIMARY KEY NOT NULL,
	"author_user_id" text NOT NULL,
	"content" text NOT NULL,
	"media_urls" text[] DEFAULT '{}' NOT NULL,
	"visibility" "post_visibility" DEFAULT 'PUBLIC' NOT NULL,
	"reply_to_post_id" text,
	"repost_of_post_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "handle_history" ADD CONSTRAINT "handle_history_veyr_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("veyr_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_identities" ADD CONSTRAINT "linked_identities_veyr_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("veyr_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_bindings" ADD CONSTRAINT "wallet_bindings_veyr_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("veyr_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_snapshots" ADD CONSTRAINT "identity_snapshots_veyr_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("veyr_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receive_preferences" ADD CONSTRAINT "receive_preferences_veyr_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("veyr_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receive_preferences" ADD CONSTRAINT "receive_preferences_primary_wallet_id_wallet_bindings_wallet_id_fk" FOREIGN KEY ("primary_wallet_id") REFERENCES "public"."wallet_bindings"("wallet_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_blocks" ADD CONSTRAINT "social_blocks_blocker_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("blocker_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_blocks" ADD CONSTRAINT "social_blocks_blocked_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("blocked_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_user_a_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_user_b_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_follows" ADD CONSTRAINT "social_follows_follower_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("follower_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_follows" ADD CONSTRAINT "social_follows_followee_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("followee_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_receipts" ADD CONSTRAINT "activity_receipts_sender_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_receipts" ADD CONSTRAINT "activity_receipts_sender_wallet_id_wallet_bindings_wallet_id_fk" FOREIGN KEY ("sender_wallet_id") REFERENCES "public"."wallet_bindings"("wallet_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_receipts" ADD CONSTRAINT "activity_receipts_recipient_snapshot_id_identity_snapshots_snapshot_id_fk" FOREIGN KEY ("recipient_snapshot_id") REFERENCES "public"."identity_snapshots"("snapshot_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_receipt_id_activity_receipts_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."activity_receipts"("receipt_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_revisions" ADD CONSTRAINT "identity_revisions_veyr_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("veyr_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_veyr_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("veyr_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_receipt_id_activity_receipts_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."activity_receipts"("receipt_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_interactions" ADD CONSTRAINT "post_interactions_post_id_posts_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("post_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_interactions" ADD CONSTRAINT "post_interactions_actor_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tips" ADD CONSTRAINT "post_tips_post_id_posts_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("post_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tips" ADD CONSTRAINT "post_tips_receipt_id_activity_receipts_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."activity_receipts"("receipt_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tips" ADD CONSTRAINT "post_tips_sender_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_user_id_veyra_users_veyr_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."veyra_users"("veyr_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_handle_history_handle_reserved" ON "handle_history" USING btree ("handle","reserved_until");--> statement-breakpoint
CREATE INDEX "ix_handle_history_user_released" ON "handle_history" USING btree ("veyr_user_id","released_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uix_linked_identities_user_provider" ON "linked_identities" USING btree ("veyr_user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "uix_linked_identities_provider_external" ON "linked_identities" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "ix_linked_identities_external_handle" ON "linked_identities" USING btree ("provider","external_handle");--> statement-breakpoint
CREATE UNIQUE INDEX "uix_veyra_users_handle_ci" ON "veyra_users" USING btree ("veyr_handle");--> statement-breakpoint
CREATE INDEX "ix_veyra_users_status" ON "veyra_users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uix_wallet_bindings_address_chain" ON "wallet_bindings" USING btree ("wallet_address","chain_id");--> statement-breakpoint
CREATE INDEX "ix_wallet_bindings_user" ON "wallet_bindings" USING btree ("veyr_user_id");--> statement-breakpoint
CREATE INDEX "ix_wallet_bindings_address_lower" ON "wallet_bindings" USING btree ("wallet_address","chain_id");--> statement-breakpoint
CREATE INDEX "ix_identity_snapshots_user_frozen" ON "identity_snapshots" USING btree ("veyr_user_id","frozen_at");--> statement-breakpoint
CREATE INDEX "ix_identity_snapshots_expiry" ON "identity_snapshots" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ix_social_blocks_pair_time" ON "social_blocks" USING btree ("blocker_user_id","blocked_user_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_social_blocks_blocked" ON "social_blocks" USING btree ("blocked_user_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_social_blocks_active_blocker" ON "social_blocks" USING btree ("blocker_user_id","blocked_user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ix_social_connections_pair_time" ON "social_connections" USING btree ("user_a_id","user_b_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_social_connections_user_b" ON "social_connections" USING btree ("user_b_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_social_connections_connected_a" ON "social_connections" USING btree ("user_a_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ix_social_connections_connected_b" ON "social_connections" USING btree ("user_b_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ix_social_follows_pair_time" ON "social_follows" USING btree ("follower_user_id","followee_user_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_social_follows_followee" ON "social_follows" USING btree ("followee_user_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_activity_receipts_sender_status" ON "activity_receipts" USING btree ("sender_user_id","status");--> statement-breakpoint
CREATE INDEX "ix_activity_receipts_dedup" ON "activity_receipts" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "ix_activity_receipts_relay_pending" ON "activity_receipts" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "ix_activity_receipts_env" ON "activity_receipts" USING btree ("environment","sender_user_id");--> statement-breakpoint
CREATE INDEX "ix_execution_events_receipt_time" ON "execution_events" USING btree ("receipt_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_execution_events_type_time" ON "execution_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_identity_revisions_user_time" ON "identity_revisions" USING btree ("veyr_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_intents_user_time" ON "intents" USING btree ("veyr_user_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_route_quotes_route_status" ON "route_quotes" USING btree ("route_id","status","veyra_ttl_expires_at");--> statement-breakpoint
CREATE INDEX "ix_route_quotes_expiry_sweep" ON "route_quotes" USING btree ("veyra_ttl_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uix_post_interactions_actor_type" ON "post_interactions" USING btree ("post_id","actor_user_id","interaction_type");--> statement-breakpoint
CREATE INDEX "ix_posts_author_time" ON "posts" USING btree ("author_user_id","created_at");