import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { Health } from '../../shared/types.ts';
import { useApi } from './lib/api.ts';
import { Blocked, SessionMissing } from './screens/Blocked.tsx';
import { Onboarding } from './screens/Onboarding.tsx';
import { Shell, type Route } from './components/Shell.tsx';
import { Review } from './screens/Review.tsx';
import { Targets } from './screens/Targets.tsx';
import { Pipeline } from './screens/Pipeline.tsx';
import { Referrals } from './screens/Referrals.tsx';
import { Dashboard } from './screens/Dashboard.tsx';
import { Settings } from './screens/Settings.tsx';
import { OfferAlerts } from './screens/OfferAlerts.tsx';
import { Connecting } from './screens/Connecting.tsx';
import { ProfileContextScreen } from './screens/ProfileContext.tsx';

const ROUTES: Route[] = ['review', 'targets', 'pipeline', 'referrals', 'dashboard', 'settings'];
const readRoute = (): Route => {
  const r = location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(r) ? r : 'review';
};

export function App() {
  const [fast, setFast] = useState(true);
  const health = useApi<Health>('/api/health', fast ? 1000 : 5000);
  const [route, setRoute] = useState<Route>(readRoute);
  const [contextOpen, setContextOpen] = useState(false);
  const h0 = health.data;
  // The "ifContext" switch: research the person once, after Claude is connected and the profile is complete.
  const needContext = Boolean(h0?.claude?.ok && h0.profileComplete && !h0.hasContext && !h0.contextSkipped);

  useEffect(() => {
    if (needContext) setContextOpen(true);
  }, [needContext]);
  // Poll fast only while something is visibly in progress.
  useEffect(() => {
    setFast(!h0 || h0.claudeCheck.checking || h0.contextJob.status === 'running');
  }, [h0]);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (r: Route) => {
    location.hash = `/${r}`;
    setRoute(r);
  };

  if (health.error?.status === 401) return <SessionMissing />;
  const h = health.data;
  if (!h || !h.claude || (h.claudeCheck.checking && !h.claude.ok)) return <Stage id="connecting"><Connecting health={h} /></Stage>;
  if (!h.claude.ok) return <Stage id="blocked"><Blocked health={h} onRecheck={health.reload} /></Stage>;
  if (needContext || contextOpen) return <Stage id="context"><ProfileContextScreen health={h} onHealth={health.reload} onContinue={() => (setContextOpen(false), health.reload())} /></Stage>;
  if (!h.onboarded) return <Stage id="onboarding"><Onboarding health={h} onHealth={health.reload} onDone={() => (health.reload(), go('targets'))} /></Stage>;

  return (
    <Stage id="app">
      <Shell route={route} go={go} health={h} onHealth={health.reload}>
        {route === 'review' && <Review onChange={health.reload} go={go} mode={h.gmail.mode} />}
        {route === 'targets' && <Targets go={go} />}
        {route === 'pipeline' && <Pipeline mode={h.gmail.mode} />}
        {route === 'referrals' && <Referrals go={go} />}
        {route === 'dashboard' && <Dashboard />}
        {route === 'settings' && <Settings health={h} onHealth={health.reload} />}
      </Shell>
      {h.pendingOffers > 0 && <OfferAlerts onChange={health.reload} go={go} sender={h.gmail.email} />}
    </Stage>
  );
}

/** Each full-screen stage (connecting, context, onboarding, app) fades in when it takes over. */
function Stage({ id, children }: { id: string; children: ReactNode }) {
  return (
    <motion.div key={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35, ease: 'easeOut' }}>
      {children}
    </motion.div>
  );
}
