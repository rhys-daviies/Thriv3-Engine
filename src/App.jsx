import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import EvidenceTab from '@/pages/player/EvidenceTab';
import Colleges from '@/pages/Colleges';
import GraduatingDatabase from '@/pages/GraduatingDatabase';
import CSVAgent from '@/pages/CSVAgent';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
              <Route path="evidence" element={<EvidenceTab />} />
              <Route path="*" element={<TabFallback />} />
            </Route>
            <Route path="/colleges" element={<Colleges />} />
            <Route path="/graduating-db" element={<GraduatingDatabase />} />
            <Route path="/csv-agent" element={<CSVAgent />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
