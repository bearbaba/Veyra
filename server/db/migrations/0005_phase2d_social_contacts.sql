-- Phase 2D — contacts + receive-preference revision hardening
CREATE TABLE IF NOT EXISTS "contacts" (
  "contact_id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "veyra_users"("veyr_user_id"),
  "contact_user_id" text NOT NULL REFERENCES "veyra_users"("veyr_user_id"),
  "alias" text,
  "favorite" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "removed_at" timestamptz,
  CONSTRAINT "chk_contacts_no_self" CHECK ("owner_user_id" <> "contact_user_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "uix_contacts_owner_contact" ON "contacts" ("owner_user_id", "contact_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uix_contacts_owner_alias_ci" ON "contacts" ("owner_user_id", lower("alias")) WHERE "removed_at" IS NULL AND "alias" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "ix_contacts_owner_active" ON "contacts" ("owner_user_id", "removed_at");

-- First-time receive preference creation changes payment resolution just like UPDATE.
DROP TRIGGER IF EXISTS trg_receive_preferences_identity_revision_insert ON receive_preferences;
CREATE TRIGGER trg_receive_preferences_identity_revision_insert
  AFTER INSERT ON receive_preferences
  FOR EACH ROW EXECUTE FUNCTION increment_identity_revision();
