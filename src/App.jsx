import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { SessionProvider, useSession } from '@/lib/session';
import SignIn from '@/pages/SignIn';
import Layout from '@/components/Layout';
import Home from '@/pages/Home';
import Sports from '@/pages/Sports';
import NewPlayer from '@/pages/NewPlayer';
import EditPlayer from '@/pages/EditPlayer';
import Players from '@/pages/Players';
import PlayerWorkspace, { TabFallback } from '@/pages/player/PlayerWorkspace';
import ProfileTab from '@/pages/player/ProfileTab';
import MatchingTab from '@/pages/player/MatchingTab';
import EngagementTab from '@/pages/player/EngagementTab';
import PhilosophyTab from '@/pages/player/PhilosophyTab';
import ReportsTab from '@/pages/player/ReportsTab';
import Colleges from '@/pages/Colleges';
import GraduatingDatabase from '@/pages/GraduatingDatabase';
import CSVAgent from '@/pages/CSVAgent';

const queryClient = new QueryClient();

/**
 * THE GATE — Phase 13K.
 *
 * Not a security boundary: that is the server, which requires a session for
 * every protected byte. This decides which screen to draw, and it draws
 * nothing at all until the server has answered, so the workspace never
 * flickers into view for somebody who is not signed in.
 *
 * On sign-out the query cache is discarded, because a cache that outlives a
 * session is athlete data left on the screen after the session that was
 * allowed to see it ended.
 */
function Authenticated({ children }) {
  const { operator, loading } = useSession();

  React.useEffect(() => {
    if (!operator) queryClient.clear();
  }, [operator]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!operator) return <SignIn />;
  return children;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
      <BrowserRouter>
        <Authenticated>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/sports" element={<Sports />} />
            <Route path="/new-player" element={<NewPlayer />} />
            <Route path="/players" element={<Players />} />
            <Route path="/player/:id/edit" element={<EditPlayer />} />
            <Route path="/player/:id" element={<PlayerWorkspace />}>
              <Route index element={<TabFallback />} />
              <Route path="profile" element={<ProfileTab />} />
              <Route path="matching" element={<MatchingTab />} />
              <Route path="engagement" element={<EngagementTab />} />
              <Route path="philosophy" element={<PhilosophyTab />} />
              <Route path="reports" element={<ReportsTab />} />
              <Route path="*" element={<TabFallback />} />
            </Route>
            <Route path="/colleges" element={<Colleges />} />
            <Route path="/graduating-db" element={<GraduatingDatabase />} />
            <Route path="/csv-agent" element={<CSVAgent />} />
          </Route>
        </Routes>
        </Authenticated>
      </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  );
}
