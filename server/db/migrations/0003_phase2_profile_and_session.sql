-- Phase 2B — ProfileService + identity revision hardening

ALTER TYPE "revision_trigger" ADD VALUE IF NOT EXISTS 'PROFILE_UPDATED';

-- Linking a new external identity changes recipient-resolution state and must
-- invalidate previously frozen identity snapshots.
DROP TRIGGER IF EXISTS trg_linked_identity_added_revision ON linked_identities;
CREATE TRIGGER trg_linked_identity_added_revision
  AFTER INSERT ON linked_identities
  FOR EACH ROW EXECUTE FUNCTION increment_identity_revision();

-- Profile fields are part of IdentitySnapshot review UI. A change after review
-- invalidates the snapshot so the sender sees the current recipient identity.
CREATE OR REPLACE FUNCTION increment_identity_revision_on_profile_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.display_name IS DISTINCT FROM NEW.display_name
     OR OLD.avatar_url IS DISTINCT FROM NEW.avatar_url
     OR OLD.bio IS DISTINCT FROM NEW.bio
     OR OLD.profile_visibility IS DISTINCT FROM NEW.profile_visibility
     OR OLD.avatar_source IS DISTINCT FROM NEW.avatar_source
     OR OLD.display_name_source IS DISTINCT FROM NEW.display_name_source
     OR OLD.bio_source IS DISTINCT FROM NEW.bio_source THEN
    NEW.identity_revision := OLD.identity_revision + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_veyra_profile_revision ON veyra_users;
CREATE TRIGGER trg_veyra_profile_revision
  BEFORE UPDATE OF display_name, avatar_url, bio, profile_visibility,
                   avatar_source, display_name_source, bio_source
  ON veyra_users
  FOR EACH ROW EXECUTE FUNCTION increment_identity_revision_on_profile_update();
