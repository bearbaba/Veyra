/**
 * Veyra App Shell
 *
 * Human-first navigation: Home / Settlement / People / Activity stay primary.
 * Advanced flows (Convert / Bridge) remain reachable through Agent/Command,
 * while Settings is deliberately secondary.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Home,
  Bot,
  SendHorizontal,
  LayoutList,
  Users,
  Settings,
  Command,
  Shield,
  ArrowLeftRight,
  Route,
  MoreHorizontal,
  ChevronDown,
} from 'lucide-react';
import { CommandBar } from '../command/CommandBar';
import { WebPreviewBanner } from '../system/WebPreviewBanner';
import { NotificationBell } from '../../features/social/NotificationBell';
import { WalletAccountControls } from './WalletAccountControls';
import { GlobalWalletBalance } from './GlobalWalletBalance';
import { VEYRA_ENV } from '@/lib/env';

export type VeyraPage = 'home' | 'agent' | 'pay' | 'convert' | 'bridge' | 'exchange' | 'activity' | 'social' | 'settings' | 'settlement';

interface NavItem {
  id: VeyraPage;
  label: string;
  icon: React.ReactNode;
  soon?: boolean;
}

const PRIMARY_NAV: NavItem[] = VEYRA_ENV === 'mainnet' ? [
  { id: 'home', label: 'Home', icon: <Home className="size-5" /> },
  { id: 'settlement', label: 'Pay', icon: <SendHorizontal className="size-5" /> },
  { id: 'social', label: 'Friends', icon: <Users className="size-5" /> },
  { id: 'activity', label: 'Activity', icon: <LayoutList className="size-5" /> },
] : [
  { id: 'home', label: 'Home', icon: <Home className="size-5" /> },
  { id: 'pay', label: 'Pay', icon: <SendHorizontal className="size-5" /> },
  { id: 'convert', label: 'Swap', icon: <ArrowLeftRight className="size-5" /> },
  { id: 'bridge', label: 'Bridge', icon: <Route className="size-5" /> },
  { id: 'agent', label: 'Agent', icon: <Bot className="size-5" /> },
  { id: 'activity', label: 'Activity', icon: <LayoutList className="size-5" /> },
];
const SECONDARY_NAV: NavItem[] = VEYRA_ENV === 'mainnet' ? [
  { id: 'convert', label: 'Swap', icon: <ArrowLeftRight className="size-5" /> },
  { id: 'bridge', label: 'Bridge', icon: <Route className="size-5" /> },
  { id: 'exchange', label: 'Exchange', icon: <ArrowLeftRight className="size-5" />, soon: true },
  { id: 'agent', label: 'Agent', icon: <Bot className="size-5" />, soon: true },
  { id: 'settings', label: 'Settings', icon: <Settings className="size-5" /> },
] : [
  { id: 'social', label: 'Friends', icon: <Users className="size-5" /> },
  { id: 'settlement', label: 'Settlement', icon: <Shield className="size-5" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="size-5" /> },
];
const MOBILE_NAV = PRIMARY_NAV.filter(item => VEYRA_ENV === 'mainnet'
  ? ['home', 'settlement', 'social', 'activity'].includes(item.id)
  : ['home', 'pay', 'agent', 'activity'].includes(item.id));
const MOBILE_MORE_NAV = VEYRA_ENV === 'mainnet'
  ? SECONDARY_NAV
  : [...PRIMARY_NAV.filter(item => item.id === 'convert' || item.id === 'bridge'), ...SECONDARY_NAV];

interface AppShellProps {
  page: VeyraPage;
  onNavigate: (page: VeyraPage) => void;
  children: React.ReactNode;
}

export function AppShell({ page, onNavigate, children }: AppShellProps) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const navigate = (next: VeyraPage) => { setMobileMoreOpen(false); onNavigate(next); };
  const moreActive = MOBILE_MORE_NAV.some(item => item.id === page);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCmdOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The Mainnet consumer surface is intentionally a calm four-destination app.
  // Advanced financial flows stay reachable from More; no financial gate changes.
  if (VEYRA_ENV === 'mainnet') {
    return (
      <div className="veyra-calm flex min-h-dvh w-full flex-col">
        <header className="veyra-calm-header relative z-30 border-b">
          <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between gap-3 px-4 py-3 md:px-7 md:py-3.5">
            <button type="button" onClick={() => navigate('home')}
              aria-label="Veyra Home" className="flex shrink-0 items-center gap-2.5">
              <VeyraLogoMark />
              <span className="display text-xl font-bold tracking-tight" style={{color:'var(--ink)'}}>Veyra</span>
            </button>
            <nav aria-label="Main navigation" className="hidden items-center gap-1 rounded-full border p-1 md:flex"
              style={{borderColor:'var(--border)',background:'var(--surface-muted)'}}>
              {PRIMARY_NAV.map(item => (
                <button key={item.id} type="button" onClick={() => navigate(item.id)}
                  aria-current={page===item.id?'page':undefined}
                  className="veyra-calm-nav-item inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold"
                  data-active={page===item.id||(item.id==='settlement'&&page==='pay')}>
                  {item.icon}<span>{item.label}</span>
                </button>
              ))}
              <details className="veyra-calm-more relative">
                <summary className="veyra-calm-nav-item inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold"
                  data-active={moreActive} aria-label="More features">
                  More <ChevronDown className="size-4" aria-hidden="true" />
                </summary>
                <div className="veyra-calm-dropdown absolute right-0 top-full z-50 mt-3 w-48 rounded-2xl border p-2 shadow-xl">
                  {SECONDARY_NAV.map(item=>(
                    <button type="button" key={item.id} disabled={item.soon}
                      onClick={e=>{navigate(item.id);e.currentTarget.closest('details')?.removeAttribute('open');}}
                      className="veyra-calm-dropdown-item flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm disabled:opacity-40">
                      {item.icon}<span className="flex-1">{item.label}</span>
                      {item.soon&&<span className="text-[10px]">Soon</span>}
                    </button>
                  ))}
                </div>
              </details>
            </nav>
            <div className="flex min-w-0 items-center gap-2 md:gap-3">
              <NotificationBell openSocial={() => navigate('social')} />
              <WalletAccountControls compact />
            </div>
          </div>
        </header>
        <WebPreviewBanner />
        <main className="veyra-calm-content min-h-0 w-full flex-1 overflow-y-auto pb-24 md:pb-8"
          id="veyra-main-content">
          <AnimatePresence mode="wait">
            <motion.div key={page}
              initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}}
              transition={{duration:0.13,ease:'easeOut'}} className="h-full">
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
        {mobileMoreOpen&&<div className="veyra-calm-mobile-more fixed inset-x-3 bottom-[76px] z-40 grid grid-cols-2 gap-2 rounded-2xl border p-3 shadow-2xl md:hidden"
          role="region" aria-label="More Veyra features">
          {MOBILE_MORE_NAV.map(item=>(
            <button key={item.id} type="button" disabled={item.soon}
              onClick={()=>navigate(item.id)}
              className="veyra-calm-dropdown-item flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold disabled:opacity-40">
              {item.icon}<span>{item.label}</span>{item.soon&&<span className="ml-auto text-[10px]">Soon</span>}
            </button>
          ))}
        </div>}
        <nav aria-label="Primary navigation"
          className="veyra-calm-mobile-nav fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t pb-[env(safe-area-inset-bottom)] md:hidden">
          {MOBILE_NAV.map(item=>(
            <button type="button" key={item.id} onClick={()=>navigate(item.id)}
              aria-current={page===item.id?'page':undefined}
              data-active={page===item.id||(item.id==='settlement'&&page==='pay')}
              className="veyra-calm-mobile-item flex min-w-0 flex-1 flex-col items-center gap-1 py-3 text-[11px] font-semibold">
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
          <button type="button" onClick={()=>setMobileMoreOpen(v=>!v)}
            aria-expanded={mobileMoreOpen} aria-label="More Veyra features" data-active={moreActive||mobileMoreOpen}
            className="veyra-calm-mobile-item flex min-w-0 flex-1 flex-col items-center gap-1 py-3 text-[11px] font-semibold">
            <MoreHorizontal className="size-5" /><span>More</span>
          </button>
        </nav>
        <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} onNavigate={navigate} />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh w-full">
      <aside
        className="hidden md:flex flex-col w-52 shrink-0 border-r px-3 py-5 gap-1"
        style={{ borderColor: 'var(--border)', background: 'rgba(4,15,34,.97)', backdropFilter: 'blur(24px)' }}
      >
        <div className="flex items-center gap-3 px-3 mb-7 pt-1">
          <VeyraLogoMark />
          <span className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Veyra</span>
        </div>

        {PRIMARY_NAV.map((item) => (
          <NavButton key={item.id} item={item} active={page === item.id || (VEYRA_ENV==='mainnet'&&item.id==='settlement'&&page==='pay')} onClick={() => onNavigate(item.id)} />
        ))}

        <div className="mt-4 border-t pt-3 space-y-1" style={{borderColor:'var(--border)'}}>
          {VEYRA_ENV==='mainnet'&&<p className="px-3 pb-1 pt-1 text-xs font-semibold" style={{color:'var(--subtle)'}}>More</p>}
          {SECONDARY_NAV.map(item => (
            <NavButton key={item.id} item={item} active={page === item.id} onClick={() => navigate(item.id)} />
          ))}
        </div>
        {VEYRA_ENV==='mainnet'&&<div className="mt-auto rounded-xl border p-3"
          style={{background:'var(--surface)',borderColor:'var(--border)'}}>
          <p className="flex items-center gap-2 text-xs font-semibold" style={{color:'var(--ink)'}}>
            <span className="size-2 rounded-full" style={{background:'var(--success)'}}/> Arc Mainnet
          </p>
          <p className="mt-1 text-[11px]" style={{color:'var(--muted)'}}>Network</p>
        </div>}
        <div className={VEYRA_ENV==='mainnet'?'mt-3 space-y-1':'mt-auto space-y-1'}>
          <button
            onClick={() => setCmdOpen(true)}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/5"
            style={{ color: 'var(--subtle)' }}
          >
            <Command className="size-4" />
            <span>Command</span>
            <kbd
              className="ml-auto text-xs px-1.5 py-0.5 rounded-md font-mono"
              style={{ background: 'var(--surface)', color: 'var(--subtle)', border: '1px solid var(--border)' }}
            >
              ⌘K
            </kbd>
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-h-dvh overflow-hidden">
        <header
          className="md:hidden flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'var(--border)', background: 'rgba(5,19,42,.94)', backdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-center gap-2">
            <VeyraLogoMark />
            <span className="display font-bold" style={{ color: 'var(--ink)' }}>Veyra</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell openSocial={() => onNavigate('social')} />
            <WalletAccountControls compact />
            <button
              onClick={() => onNavigate('settings')}
              className="rounded-xl p-2"
              style={{ background: page === 'settings' ? 'var(--accent-muted)' : 'var(--surface)', color: page === 'settings' ? 'var(--accent)' : 'var(--muted)', border: '1px solid var(--border)' }}
              aria-label="Settings"
            >
              <Settings className="size-4" />
            </button>
           </div>
        </header>

        <div className="hidden md:flex items-center justify-end gap-3 border-b px-5 py-2" style={{ borderColor: 'var(--border)' }}>
          <WalletAccountControls />
          <NotificationBell openSocial={() => onNavigate('social')} />
        </div>
        <WebPreviewBanner />
        {VEYRA_ENV!=='mainnet'&&<GlobalWalletBalance />}

        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="h-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>

        {mobileMoreOpen && (
          <div role="region" aria-label="More Veyra features" className="md:hidden grid grid-cols-2 gap-2 border-t p-3"
            style={{borderColor:'var(--border)',background:'var(--surface-strong)'}}>
            {MOBILE_MORE_NAV.map(item => (
              <button type="button" key={item.id} disabled={item.soon} aria-label={item.soon?item.label+" coming soon":item.label} onClick={() => navigate(item.id)}
                className="flex min-w-0 items-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold"
                style={{borderColor:'var(--border)',color:page===item.id?'var(--accent)':'var(--ink)'}}>
                {item.icon}<span className="flex-1 text-left">{item.label}</span>{item.soon&&<span className="text-[10px] opacity-65">Soon</span>}
              </button>
            ))}
          </div>
        )}
        <nav aria-label="Primary navigation"
          className="md:hidden flex items-center border-t"
          style={{ borderColor: 'var(--border)', background: 'rgba(5,19,42,.95)', backdropFilter: 'blur(20px)' }}
        >
          {MOBILE_NAV.map((item) => (
            <button type="button"
              key={item.id}
              onClick={() => navigate(item.id)}
              className="flex min-w-0 flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors"
              aria-current={page === item.id || (VEYRA_ENV==='mainnet'&&item.id==='settlement'&&page==='pay') ? 'page' : undefined}
              style={{ color: page === item.id ? 'var(--accent)' : 'var(--subtle)' }}
            >
              <span style={{ color: page === item.id ? 'var(--accent)' : 'var(--subtle)' }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
          <button type="button" onClick={() => setMobileMoreOpen(open => !open)} aria-expanded={mobileMoreOpen}
            aria-label="More Veyra features" className="flex min-w-0 flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium"
            style={{color:moreActive||mobileMoreOpen?'var(--accent)':'var(--subtle)'}}>
            <MoreHorizontal className="size-5"/>More
          </button>
        </nav>
      </main>

      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} onNavigate={navigate} />
    </div>
  );
}

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick} disabled={item.soon} aria-label={item.soon?item.label+" coming soon":item.label}
      className="relative flex w-full items-center gap-2.5 px-3 py-3 rounded-xl text-sm font-semibold transition-all"
      style={{ color: active ? 'var(--accent)' : 'var(--muted)', background: active ? 'rgba(44,105,198,.22)' : 'transparent' }}
    >
      {active && (
        <motion.span layoutId="nav-indicator" className="absolute left-0 inset-y-2 w-0.5 rounded-r-full" style={{ background: 'var(--accent)' }} />
      )}
      <span style={{ color: active ? 'var(--accent)' : 'var(--muted)' }}>{item.icon}</span>
      <span className="flex-1 text-left">{item.label}</span>{item.soon&&<span className="text-[10px] font-medium opacity-65">Soon</span>}
    </button>
  );
}

function VeyraLogoMark() {
  return (
    <div className="flex size-7 items-center justify-center rounded-lg" style={{ background: 'var(--accent-muted)', border: '1px solid var(--border-strong)' }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" stroke="var(--accent)" strokeWidth="1.5" />
        <circle cx="7" cy="7" r="2" fill="var(--accent)" />
      </svg>
    </div>
  );
}
