import { createRoot } from 'react-dom/client';
import WorkspaceGate from './workspace-gate';
import WorkSectionPageBridge from './work-section-page-bridge';
import PersonalAreasHomeBridge from './personal-areas-home-bridge';
import './globals.css';

function keepPwaFresh() {
  if (!('serviceWorker' in navigator)) return;

  const base = new URL(document.baseURI);
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  let registration: ServiceWorkerRegistration | null = null;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  const checkForUpdate = () => {
    if (!registration || document.visibilityState === 'hidden') return;
    void registration.update().catch(() => {});
  };

  void navigator.serviceWorker.register(new URL('sw.js', base), {
    scope: base.pathname,
    updateViaCache: 'none',
  }).then(next => {
    registration = next;
    checkForUpdate();
    window.addEventListener('focus', checkForUpdate);
    document.addEventListener('visibilitychange', checkForUpdate);
  }).catch(() => {});
}

keepPwaFresh();
createRoot(document.getElementById('root')!).render(<><WorkspaceGate /><WorkSectionPageBridge /><PersonalAreasHomeBridge /></>);
