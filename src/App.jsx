import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from '@/components/Layout';
import Home from '@/pages/Home';
import Sports from '@/pages/Sports';
import NewPlayer from '@/pages/NewPlayer';
import EditPlayer from '@/pages/EditPlayer';
import Players from '@/pages/Players';
import PlayerDetail from '@/pages/PlayerDetail';
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
            <Route path="/player/:id" element={<PlayerDetail />} />
            <Route path="/player/:id/edit" element={<EditPlayer />} />
            <Route path="/colleges" element={<Colleges />} />
            <Route path="/graduating-db" element={<GraduatingDatabase />} />
            <Route path="/csv-agent" element={<CSVAgent />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
