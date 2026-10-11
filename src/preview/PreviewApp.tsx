/**
 * Zero-financial-execution application tree for Vercel static Preview.
 *
 * A separate Vite HTML entry resolves only this tree, not src/App.tsx.
 * This is important: JSX flags alone cannot prove wallet-signing modules
 * are absent from a published browser bundle.
 */
import { useState } from 'react';
import { AppShell, type VeyraPage } from '../components/layout/AppShell';
import { UiOnlyPreviewPage } from '../components/pages/UiOnlyPreviewPage';
import {
  PreviewHome,
  PreviewAgent,
  PreviewActivity,
  PreviewSettings,
} from './PreviewSurfaces';

export function PreviewApp() {
  const [page, setPage] = useState<VeyraPage>('home');

  function renderPage() {
    switch (page) {
      case 'home':
        return <PreviewHome onNavigate={setPage} />;
      case 'agent':
        return <PreviewAgent onNavigate={setPage} />;
      case 'pay':
      case 'convert':
      case 'bridge':
        return <UiOnlyPreviewPage surface={page} />;
      case 'activity':
        return <PreviewActivity />;
      case 'settings':
        return <PreviewSettings />;
      default:
        return <PreviewHome onNavigate={setPage} />;
    }
  }

  return (
    <AppShell page={page} onNavigate={setPage}>
      {renderPage()}
    </AppShell>
  );
}
