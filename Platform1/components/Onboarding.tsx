
import React, { useState } from 'react';
import { generateAgentAppeal } from '../services/geminiService';
import { AgentAppeal } from '../types';

interface OnboardingProps {
  onAASaved: (aa: AgentAppeal) => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onAASaved }) => {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [generatedAA, setGeneratedAA] = useState<AgentAppeal | null>(null);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const messages = [
    "Analyzing URL architecture...",
    "Crawling site metadata...",
    "Extracting core capabilities...",
    "Mapping integration endpoints...",
    "Synthesizing Agent Appeal scaffold...",
    "Validating against Vercept standards..."
  ];

  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setIsLoading(true);
    setError('');
    
    let messageIdx = 0;
    const interval = setInterval(() => {
      setStatusMessage(messages[messageIdx % messages.length]);
      messageIdx++;
    }, 2000);

    try {
      const aa = await generateAgentAppeal(url);
      setGeneratedAA(aa);
    } catch (err) {
      setError('Failed to generate Agent Appeal. Please check the URL and try again.');
    } finally {
      clearInterval(interval);
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold text-white mb-4">Onboard Your Product</h2>
        <p className="text-slate-400">Provide your product URL. Our AI scraper will generate a comprehensive Agent Appeal (AA) document.</p>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 shadow-xl">
        <form onSubmit={handleScrape} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Product Website URL</label>
            <div className="flex gap-4">
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-product.com"
                className="block w-full rounded-md bg-slate-950 border border-slate-700 px-4 py-3 text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-indigo-500"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-8 rounded-md transition-all disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Scraping...
                  </>
                ) : 'Generate AA'}
              </button>
            </div>
          </div>
          {isLoading && (
            <div className="text-center py-4">
              <p className="text-indigo-400 animate-pulse mono text-sm">{statusMessage}</p>
            </div>
          )}
          {error && <p className="text-red-400 text-sm bg-red-900/20 p-3 rounded border border-red-900/50">{error}</p>}
        </form>

        {generatedAA && !isLoading && (
          <div className="mt-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-white">Generated Agent Appeal</h3>
              <button
                onClick={() => onAASaved(generatedAA)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-6 rounded-md transition-all"
              >
                Approve & Publish to Catalog
              </button>
            </div>
            
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-6 overflow-x-auto">
              <pre className="text-sm text-slate-300 mono whitespace-pre-wrap">
                {JSON.stringify(generatedAA, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Onboarding;
