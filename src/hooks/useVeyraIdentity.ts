import type { MyProfile } from '@/lib/api/identityApi';
import { useUnifiedSocial } from '../features/social/UnifiedSocial';

const PREVIEW_KEY = 'veyra:preview-identity';

export interface VeyraIdentityState {
  profile: MyProfile | null;
  preview: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function savePreviewVeyraIdentity(handle: string): MyProfile {
  const clean = handle.replace(/^@/, '').toLowerCase();
  const profile: MyProfile = {
    veyraUserId: `preview_${clean}`,
    veyraHandle: clean,
    displayName: clean,
    x: null,
  };
  localStorage.setItem(PREVIEW_KEY, JSON.stringify(profile));
  return profile;
}

export function clearPreviewVeyraIdentity(): void {
  localStorage.removeItem(PREVIEW_KEY);
}

export function useVeyraIdentity(): VeyraIdentityState {
  const social = useUnifiedSocial();
  // Settings always reflects the connected, SIGNED wallet identity.
  // A local preview handle cannot pose as a live canonical ID.
  const verified = social.session?.profile;
  const profile: MyProfile | null = verified
    ? {
        veyraUserId: verified.veyraUserId,
        veyraHandle: verified.veyraHandle,
        displayName: verified.displayName,
        x: verified.x ?? null,
      }
    : null;
  return { profile, preview: false, loading: social.busy, refresh: social.refresh };
}
