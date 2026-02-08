import React, { useState, useEffect, useMemo } from 'react';
import Navbar from './components/Navbar';
import LandingPage from './components/LandingPage';
import Onboarding from './components/Onboarding';
import Catalog from './components/Catalog';
import WellKnownPreview from './components/WellKnownPreview';
import { AgentAppeal, Platform1AiJson, AgentCatalogResponse } from './types';

const WELL_KNOWN_BASE = '/platform1/.well-known';

const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState('/');
  const [localAppeals, setLocalAppeals] = useState<AgentAppeal[]>([]);
  const [aiDescriptor, setAiDescriptor] = useState<Platform1AiJson | null>(null);
  const [catalogResponse, setCatalogResponse] = useState<AgentCatalogResponse | null>(null);
  const [wellKnownLoading, setWellKnownLoading] = useState(true);

  // Fetch .well-known/ai.json and agent-catalog.json
  useEffect(() => {
    let cancelled = false;
    setWellKnownLoading(true);
    Promise.all([
      fetch(`${WELL_KNOWN_BASE}/ai.json`).then(r => r.ok ? r.json() : null),
      fetch(`${WELL_KNOWN_BASE}/agent-catalog.json`).then(r => r.ok ? r.json() : null)
    ]).then(([ai, catalog]) => {
      if (cancelled) return;
      setAiDescriptor(ai as Platform1AiJson | null);
      setCatalogResponse(catalog as AgentCatalogResponse | null);
    }).catch(() => {}).finally(() => {
      if (!cancelled) setWellKnownLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Initialize local appeals from LocalStorage (user-onboarded only)
  useEffect(() => {
    const saved = localStorage.getItem('p1-appeals');
    if (saved) {
      try {
        setLocalAppeals(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load saved appeals');
      }
    }
  }, []);

  // Merged catalog: server agent_appeals + local appeals (local overwrites by id)
  const appeals = useMemo(() => {
    const fromServer = catalogResponse?.agent_appeals ?? [];
    const byId = new Map<string, AgentAppeal>();
    fromServer.forEach(aa => byId.set(aa.id, aa));
    localAppeals.forEach(aa => byId.set(aa.id, aa));
    return Array.from(byId.values());
  }, [catalogResponse, localAppeals]);

  // Save local appeals to LocalStorage
  useEffect(() => {
    if (localAppeals.length > 0) {
      localStorage.setItem('p1-appeals', JSON.stringify(localAppeals));
    }
  }, [localAppeals]);

  const handleAASaved = (aa: AgentAppeal) => {
    setLocalAppeals(prev => [...prev.filter(a => a.id !== aa.id), aa]);
    setCurrentPath('/catalog');
  };

  const renderView = () => {
    switch (currentPath) {
      case '/':
        return <LandingPage onStart={() => setCurrentPath('/onboard')} />;
      case '/onboard':
        return <Onboarding onAASaved={handleAASaved} />;
      case '/catalog':
        return <Catalog appeals={appeals} />;
      case '/well-known':
        return (
          <WellKnownPreview
            appeals={appeals}
            aiDescriptor={aiDescriptor}
            catalogResponse={catalogResponse}
            loading={wellKnownLoading}
          />
        );
      default:
        return <LandingPage onStart={() => setCurrentPath('/onboard')} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500/30">
      <Navbar currentPath={currentPath} onNavigate={setCurrentPath} />
      <main className="pb-20">
        {renderView()}
      </main>
      
      {/* Footer Decoration */}
      <footer className="py-10 border-t border-slate-900 bg-slate-950 text-center">
        <div className="flex justify-center items-center gap-6 mb-4">
          <div className="w-1.5 h-1.5 rounded-full bg-slate-800"></div>
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500/50"></div>
          <div className="w-1.5 h-1.5 rounded-full bg-slate-800"></div>
        </div>
        <p className="text-slate-600 text-xs mono uppercase tracking-[0.2em]">Platform1 • Built for Autonomous Futures</p>
      </footer>
    </div>
  );
};

export default App;
