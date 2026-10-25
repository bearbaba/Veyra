import type { MyProfile } from '@/lib/api/identityApi';
import { useUnifiedSocial } from '../features/social/UnifiedSocial';
import {useAccount} from 'wagmi';
import {readLastVerifiedVeyraId} from '../lib/api/lastVerifiedVeyraId';

const PREVIEW_KEY = 'veyra:preview-identity';

export interface VeyraIdentityState {
  profile: MyProfile | null;
  lastUsedHandle: string | null;
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
  const {address,isConnected}=useAccount();
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
  const lastUsedHandle=!profile&&isConnected?readLastVerifiedVeyraId(address):null;
  return { profile, lastUsedHandle, preview: false, loading: social.busy, refresh: social.refresh };
}
