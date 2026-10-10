-- Phase 5 — production ActivityReceipt lifecycle metadata.
-- Adds the fields required for revision-aware browser/BFF reconciliation while
-- preserving the normalized Phase 1 receipt identifiers and bridge trace.

ALTER TYPE receipt_status ADD VALUE IF NOT EXISTS 'SOURCE_CONFIRMED';
--> statement-breakpoint
ALTER TYPE receipt_status ADD VALUE IF NOT EXISTS 'ATTESTATION_PENDING';
--> statement-breakpoint
ALTER TYPE receipt_status ADD VALUE IF NOT EXISTS 'CANCELLED';
--> statement-breakpoint
ALTER TYPE execution_event_type ADD VALUE IF NOT EXISTS 'RESUMED';
--> statement-breakpoint
ALTER TYPE execution_event_type ADD VALUE IF NOT EXISTS 'CANCELLED';
--> statement-breakpoint

ALTER TABLE activity_receipts
  ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'BRIDGE',
  ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'BRIDGE',
  ADD COLUMN IF NOT EXISTS provider_version text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS route_option jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS policy_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS preflight_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resume_payload jsonb,
  ADD COLUMN IF NOT EXISTS resumable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_written_by text NOT NULL DEFAULT 'bff',
  ADD COLUMN IF NOT EXISTS last_written_at timestamptz NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ix_activity_receipts_route_status
  ON activity_receipts (route_id, status);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ix_activity_receipts_resumable
  ON activity_receipts (sender_user_id, resumable, updated_at);
