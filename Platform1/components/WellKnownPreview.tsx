import React from 'react';
import { AgentAppeal, Platform1AiJson, AgentCatalogResponse } from '../types';

interface WellKnownPreviewProps {
  appeals: AgentAppeal[];
  aiDescriptor: Platform1AiJson | null;
  catalogResponse: AgentCatalogResponse | null;
  loading?: boolean;
}

const WellKnownPreview: React.FC<WellKnownPreviewProps> = ({
  appeals,
  aiDescriptor,
  catalogResponse,
  loading = false
}) => {
  const displayCatalog = catalogResponse ?? {
    updated_at: new Date().toISOString().slice(0, 10),
    count: appeals.length,
    agent_appeals: appeals
  };
  const displayAi = aiDescriptor ?? {
    site: 'texflow.work',
    product: 'Platform1',
    purpose: 'Agent Discovery Hub',
    intended_audience: ['AI agents', 'autonomous systems'],
    catalog: '/.well-known/agent-catalog.json',
    capabilities: ['discovery', 'onboarding', 'agent_appeal_generation', 'standardization'],
    endpoints: {
      discovery: '/platform1/.well-known/ai.json',
      catalog: '/.well-known/agent-catalog.json'
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-12 px-4">
      <div className="mb-12">
        <h2 className="text-3xl font-bold text-white mb-2">Agent Endpoints</h2>
        <p className="text-slate-400">
          Discovery at <span className="font-mono text-indigo-400">/platform1/.well-known/ai.json</span>; product catalog at <span className="font-mono text-indigo-400">/.well-known/agent-catalog.json</span>.
        </p>
      </div>

      {loading && (
        <p className="text-slate-500 text-sm mb-6">Loading .well-known data…</p>
      )}

      <div className="space-y-12">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="bg-slate-800 text-slate-300 px-3 py-1 rounded text-xs mono">GET</span>
            <span className="text-indigo-400 font-bold font-mono">/platform1/.well-known/ai.json</span>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
            <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex justify-between">
              <span className="text-xs text-slate-500 uppercase tracking-wider mono">application/json</span>
            </div>
            <pre className="p-6 text-sm text-indigo-300 mono whitespace-pre-wrap max-h-96 overflow-y-auto">
              {JSON.stringify(displayAi, null, 2)}
            </pre>
          </div>
        </div>

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
              {JSON.stringify(displayCatalog, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WellKnownPreview;
