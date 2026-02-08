
import React from 'react';
import { AgentAppeal } from '../types';

interface CatalogProps {
  appeals: AgentAppeal[];
}

const Catalog: React.FC<CatalogProps> = ({ appeals }) => {
  // Group by category
  const categoriesMap: Record<string, AgentAppeal[]> = {};
  appeals.forEach(aa => {
    const primaryCat = aa.category[0] || 'Uncategorized';
    if (!categoriesMap[primaryCat]) categoriesMap[primaryCat] = [];
    categoriesMap[primaryCat].push(aa);
  });

  return (
    <div className="max-w-7xl mx-auto py-12 px-4">
      <div className="mb-12">
        <h2 className="text-3xl font-bold text-white mb-2">Agent Appeal Catalog</h2>
        <p className="text-slate-400">Products currently registered and available for Vy Agents.</p>
        <p className="text-slate-500 text-sm mt-1 font-mono">
          Catalog endpoint: <span className="text-indigo-400">GET /platform1/.well-known/agent-catalog.json</span>
        </p>
      </div>

      {appeals.length === 0 ? (
        <div className="text-center py-20 bg-slate-900/30 rounded-2xl border border-dashed border-slate-800">
          <p className="text-slate-500 italic">No products onboarded yet.</p>
        </div>
      ) : (
        Object.entries(categoriesMap).map(([category, items]) => (
          <section key={category} className="mb-12">
            <div className="flex items-center gap-4 mb-6">
              <h3 className="text-lg font-bold text-indigo-400 uppercase tracking-wider">{category}</h3>
              <div className="h-px flex-1 bg-slate-800"></div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {items.map((aa) => (
                <div key={aa.id} className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 hover:border-indigo-500/50 transition-all flex flex-col group">
                  <div className="flex items-start justify-between mb-4">
                    <span className="inline-flex items-center rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-400 ring-1 ring-inset ring-slate-700">
                      {aa.type}
                    </span>
                    <span className="text-[10px] mono text-slate-600">ID: {aa.id.substring(0, 8)}</span>
                  </div>
                  <h4 className="text-xl font-bold text-white mb-2">{aa.name}</h4>
                  <p className="text-slate-400 text-sm line-clamp-3 mb-6 flex-grow">{aa.summary}</p>
                  
                  <div className="space-y-4">
                    <div>
                      <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-tighter mb-2">Capabilities</h5>
                      <div className="flex flex-wrap gap-1">
                        {aa.capabilities.slice(0, 3).map((cap, i) => (
                          <span key={i} className="text-[10px] bg-indigo-500/10 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/20">{cap}</span>
                        ))}
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-slate-500">Provider</span>
                        <span className="text-xs text-slate-300">{aa.provider.name}</span>
                      </div>
                      <a 
                        href={aa.action.learn_more} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-indigo-400 hover:text-indigo-300"
                      >
                        Visit Site →
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
};

export default Catalog;
