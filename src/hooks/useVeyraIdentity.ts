import { useCallback, useEffect, useState } from 'react';
import { getMyProfile, type MyProfile } from '@/lib/api/identityApi';

const PREVIEW_KEY = 'veyra:preview-identity';

export interface VeyraIdentityState {
  profile: MyProfile | null;
  preview: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

function readPreview(): MyProfile | null {
  try {
    const raw = localStorage.getItem(PREVIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MyProfile>;
    if (typeof parsed.veyraHandle !== 'string' || !parsed.veyraHandle) return null;
    return {
      veyraUserId: typeof parsed.veyraUserId === 'string' ? parsed.veyraUserId : `preview_${parsed.veyraHandle}`,
      veyraHandle: parsed.veyraHandle,
      displayName: typeof parsed.displayName === 'string' && parsed.displayName ? parsed.displayName : parsed.veyraHandle,
      x: parsed.x && typeof parsed.x.xAccountId === 'string'
        ? { xAccountId: parsed.x.xAccountId, xHandle: parsed.x.xHandle ?? null }
        : null,
    };
  } catch {
    return null;
  }
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
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getMyProfile();
      setProfile(next);
      setPreview(false);
      clearPreviewVeyraIdentity();
    } catch {
      const local = readPreview();
      setProfile(local);
      setPreview(Boolean(local));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { profile, preview, loading, refresh };
}
