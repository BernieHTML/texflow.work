
import React from 'react';
import { AgentAppeal } from '../types';

interface WellKnownPreviewProps {
  appeals: AgentAppeal[];
}

const WellKnownPreview: React.FC<WellKnownPreviewProps> = ({ appeals }) => {
  // Format the catalog as expected by the agent
  const categoriesMap: Record<string, { title: string; items: any[] }> = {};
  
  appeals.forEach(aa => {
    const primaryCat = aa.category[0] || 'Uncategorized';
    if (!categoriesMap[primaryCat]) {
      categoriesMap[primaryCat] = {
        title: primaryCat,
        items: []
      };
    }
    categoriesMap[primaryCat].items.push({
      id: aa.id,
      name: aa.name,
      summary: aa.summary,
      url: aa.action.learn_more,
      automation_ready: aa.integration.automation_friendly
    });
  });

  const agentCatalogJson = {
    version: "1.0",
    last_updated: new Date().toISOString(),
    endpoints: {
      discovery: "/.well-known/agent-catalog.json",
      appeal_detail: "/api/appeals/{id}"
    },
    categories: Object.values(categoriesMap)
  };

  const aiAgentJson = {
    agent_id: "platform1-hub",
    support_email: "agents@platform1.io",
    capabilities: ["discovery", "onboarding", "standardization"],
    catalog_url: "https://platform1.io/#/well-known/agent-catalog.json"
  };

  return (
    <div className="max-w-5xl mx-auto py-12 px-4">
      <div className="mb-12">
        <h2 className="text-3xl font-bold text-white mb-2">Agent Endpoints</h2>
        <p className="text-slate-400">Standardized /.well-known discovery paths for autonomous agents.</p>
      </div>

      <div className="space-y-12">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="bg-slate-800 text-slate-300 px-3 py-1 rounded text-xs mono">GET</span>
            <span className="text-indigo-400 font-bold font-mono">/.well-known/agent-catalog.json</span>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
             <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex justify-between">
                <span className="text-xs text-slate-500 uppercase tracking-wider mono">application/json</span>
             </div>
             <pre className="p-6 text-sm text-emerald-400 mono whitespace-pre-wrap max-h-96 overflow-y-auto">
               {JSON.stringify(agentCatalogJson, null, 2)}
             </pre>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="bg-slate-800 text-slate-300 px-3 py-1 rounded text-xs mono">GET</span>
            <span className="text-indigo-400 font-bold font-mono">/.well-known/ai-agent.json</span>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
             <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex justify-between">
                <span className="text-xs text-slate-500 uppercase tracking-wider mono">application/json</span>
             </div>
             <pre className="p-6 text-sm text-indigo-300 mono whitespace-pre-wrap">
               {JSON.stringify(aiAgentJson, null, 2)}
             </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WellKnownPreview;
