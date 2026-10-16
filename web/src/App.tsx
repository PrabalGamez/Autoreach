import { useEffect, useState } from 'react';
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
import { Spinner } from './components/ui.tsx';

const ROUTES: Route[] = ['review', 'targets', 'pipeline', 'referrals', 'dashboard', 'settings'];
const readRoute = (): Route => {
  const r = location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(r) ? r : 'review';
};

export function App() {
  const health = useApi<Health>('/api/health', 5000);
  const [route, setRoute] = useState<Route>(readRoute);

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
  if (!health.data) {
    return (
      <div className="grid h-dvh place-items-center text-ink-3">
        <Spinner className="size-6" />
      </div>
    );
  }
  const h = health.data;
  if (!h.claude?.ok) return <Blocked health={h} onRecheck={health.reload} />;
  if (!h.onboarded) return <Onboarding health={h} onHealth={health.reload} onDone={() => (health.reload(), go('targets'))} />;

  return (
    <>
      <Shell route={route} go={go} health={h} onHealth={health.reload}>
        {route === 'review' && <Review onChange={health.reload} go={go} />}
        {route === 'targets' && <Targets go={go} />}
        {route === 'pipeline' && <Pipeline />}
        {route === 'referrals' && <Referrals go={go} />}
        {route === 'dashboard' && <Dashboard />}
        {route === 'settings' && <Settings health={h} onHealth={health.reload} />}
      </Shell>
      {h.pendingOffers > 0 && <OfferAlerts onChange={health.reload} go={go} />}
    </>
  );
}
