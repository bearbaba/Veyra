/**
 * Veyra Settings / Policies Page
 *
 * Shows active policy rules and lets the user view their address.
 * Policy values come from the deterministic Policy Engine — not editable via LLM.
 */

import { useAccount } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { Shield, Copy, Check, Info, Link2, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_VEYRA_POLICY } from '@/core/policy/policyEngine';
import { SECURITY_CONFIG } from '@/lib/securityConfig';
import { VEYRA_ENV } from '@/lib/env';
import { beginXLink, getMyProfile, type MyProfile } from '@/lib/api/identityApi';

export function SettingsPage() {
  const { address, isConnected } = useAccount();
  const [copied, setCopied] = useState(false);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [xLoading, setXLoading] = useState(false);
  const [xError, setXError] = useState<string | null>(null);


  useEffect(() => {
    let cancelled = false;
    void getMyProfile().then((next) => {
      if (!cancelled) setProfile(next);
    }).catch(() => {
      // A wallet-only user may not have a Veyra session yet. Keep Settings usable.
    });
    return () => { cancelled = true; };
  }, []);

  async function linkX() {
    setXLoading(true);
    setXError(null);
    try {
      const authorizeUrl = await beginXLink('/settings');
      window.location.assign(authorizeUrl);
    } catch (err) {
      setXError(err instanceof Error ? err.message : 'Unable to start X linking');
      setXLoading(false);
    }
  }

  function copyAddress() {
    if (!address) return;
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="display text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
          Settings
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Policies and configuration</p>
      </div>

      {/* Wallet */}
      <Section title="Wallet">
        {!isConnected ? (
          <div className="flex items-center justify-between">
            <p className="text-sm" style={{ color: 'var(--muted)' }}>No wallet connected</p>
            <ConnectKitButton />
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="mono text-sm" style={{ color: 'var(--ink-2)' }}>
              {address}
            </span>
            <button
              onClick={copyAddress}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}
            >
              {copied ? <Check className="size-3.5" style={{ color: 'var(--success)' }} /> : <Copy className="size-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </Section>

      {/* Linked identity */}
      <Section title="Linked Identity" icon={<Link2 className="size-4" />}>
        {profile?.x ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                @{profile.x.xHandle ?? 'X account'}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                X account ID {profile.x.xAccountId} · immutable binding
              </p>
            </div>
            <span className="text-xs px-2 py-1 rounded-full"
              style={{ background: 'var(--success-muted)', color: 'var(--success)' }}>
              Linked
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Link X to let people resolve your current X handle to your Veyra identity. Your numeric X account ID is the binding key.
            </p>
            <button
              onClick={() => void linkX()}
              disabled={xLoading}
              className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', color: 'var(--ink)' }}
            >
              {xLoading ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
              Link X account
            </button>
            {xError && <p className="text-xs" style={{ color: 'var(--danger)' }}>{xError}</p>}
          </div>
        )}
      </Section>

      {/* Environment */}
      <Section title="Environment">
        <div className="flex items-center gap-2">
          <span
            className="text-xs px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider"
            style={{
              background: VEYRA_ENV === 'mainnet' ? 'var(--danger-muted)' : 'var(--success-muted)',
              color: VEYRA_ENV === 'mainnet' ? 'var(--danger)' : 'var(--success)',
            }}
          >
            {VEYRA_ENV}
          </span>
          {VEYRA_ENV !== 'mainnet' && (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              Testnet — no real funds
            </span>
          )}
        </div>
      </Section>

      {/* Active policy */}
      <Section title="Active Policy" icon={<Shield className="size-4" />}>
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
              {DEFAULT_VEYRA_POLICY.displayName}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--success-muted)', color: 'var(--success)' }}>
              Active
            </span>
          </div>
          <div className="flex items-start gap-2 rounded-xl p-3"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <Info className="size-3.5 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Policy rules are deterministic and cannot be overridden by the Agent.
              All financial actions must pass policy evaluation before execution.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {DEFAULT_VEYRA_POLICY.rules.slice(0, 6).map((rule) => (
              <PolicyRuleChip key={rule.ruleId} rule={rule} />
            ))}
          </div>
        </div>
      </Section>

      {/* Security constants */}
      <Section title="Security Constants">
        <div className="space-y-2">
          <SecurityRow label="Max provenance age" value={`${SECURITY_CONFIG.MAX_PROVENANCE_AGE_MS / 1000}s`} />
          <SecurityRow label="Max balance age" value={`${SECURITY_CONFIG.MAX_BALANCE_AGE_MS / 1000}s`} />
          <SecurityRow label="Provider health TTL" value={`${SECURITY_CONFIG.MAX_PROVIDER_HEALTH_AGE_MS / 1000}s`} />
          <SecurityRow label="Quote expiry buffer" value={`${SECURITY_CONFIG.QUOTE_EXPIRY_BUFFER_MS / 1000}s`} />
          <SecurityRow label="Default max slippage" value={`${SECURITY_CONFIG.DEFAULT_MAX_SLIPPAGE_BPS} bps`} />
          <SecurityRow label="Quote reservation TTL" value={`${SECURITY_CONFIG.QUOTE_RESERVATION_TIMEOUT_MS / 1000}s`} />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5 space-y-3"
      style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2">
        {icon && <span style={{ color: 'var(--accent)' }}>{icon}</span>}
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function PolicyRuleChip({ rule }: { rule: { ruleId: string } }) {
  return (
    <div
      className="rounded-xl px-3 py-2"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <span className="text-xs font-mono" style={{ color: 'var(--ink-2)' }}>
        {rule.ruleId}
      </span>
    </div>
  );
}

function SecurityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>{value}</span>
    </div>
  );
}
