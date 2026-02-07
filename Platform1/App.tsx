
import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import LandingPage from './components/LandingPage';
import Onboarding from './components/Onboarding';
import Catalog from './components/Catalog';
import WellKnownPreview from './components/WellKnownPreview';
import { AgentAppeal } from './types';

const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState('/');
  const [appeals, setAppeals] = useState<AgentAppeal[]>([]);

  // Initialize from LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem('p1-appeals');
    if (saved) {
      try {
        setAppeals(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load saved appeals");
      }
    } else {
      // Default placeholder if empty
      const placeholder: AgentAppeal = {
        id: "default-vy-helper",
        name: "Vercept Connector",
        type: "tool",
        category: ["Automation"],
        provider: {
          name: "Platform1 Team",
          website: "https://platform1.io"
        },
        summary: "Standardized bridge for Vy agents to interact with third party platforms.",
        problem_solved: ["Agent compatibility", "Protocol mapping"],
        capabilities: ["Translation", "Discovery"],
        inputs_required: ["API Key"],
        outputs_provided: ["Discovery JSON"],
        pricing: {
          model: "free",
          free_tier: true,
          paid_tier: false
        },
        integration: {
          access: "api",
          authentication: "none",
          automation_friendly: true
        },
        constraints: ["Rate limited"],
        action: {
          learn_more: "https://platform1.io",
          purchase: "https://platform1.io"
        },
        metadata: {
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      };
      setAppeals([placeholder]);
    }
  }, []);

  // Save to LocalStorage
  useEffect(() => {
    if (appeals.length > 0) {
      localStorage.setItem('p1-appeals', JSON.stringify(appeals));
    }
  }, [appeals]);

  const handleAASaved = (aa: AgentAppeal) => {
    setAppeals(prev => [...prev.filter(a => a.id !== aa.id), aa]);
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
        return <WellKnownPreview appeals={appeals} />;
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
