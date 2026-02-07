
import React from 'react';

interface LandingPageProps {
  onStart: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onStart }) => {
  return (
    <div className="relative isolate overflow-hidden">
      <div className="mx-auto max-w-7xl px-6 pb-24 pt-10 sm:pb-32 lg:flex lg:px-8 lg:pt-40">
        <div className="mx-auto max-w-2xl flex-shrink-0 lg:mx-0 lg:max-w-xl lg:pt-8">
          <div className="mt-24 sm:mt-32 lg:mt-16">
            <a href="#" className="inline-flex space-x-6">
              <span className="rounded-full bg-indigo-500/10 px-3 py-1 text-sm font-semibold leading-6 text-indigo-400 ring-1 ring-inset ring-indigo-500/20">
                Optimized for Vy Agents
              </span>
            </a>
          </div>
          <h1 className="mt-10 text-4xl font-bold tracking-tight text-white sm:text-6xl">
            Bridge your product to the <span className="text-indigo-500">Agentic Economy</span>.
          </h1>
          <p className="mt-6 text-lg leading-8 text-slate-300">
            Platform1 provides a standardized infrastructure for AI agents like Vy (Vercept) to find, evaluate, and integrate your products directly into user workflows.
          </p>
          <div className="mt-10 flex items-center gap-x-6">
            <button
              onClick={onStart}
              className="rounded-md bg-indigo-600 px-6 py-3 text-lg font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition-all"
            >
              Onboard Your Product
            </button>
            <a href="#/well-known" className="text-sm font-semibold leading-6 text-white">
              Explore Endpoints <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
        <div className="mx-auto mt-16 flex max-w-2xl sm:mt-24 lg:ml-10 lg:mr-0 lg:mt-0 lg:max-w-none lg:flex-none xl:ml-32">
          <div className="max-w-3xl flex-none sm:max-w-5xl lg:max-w-none">
            <div className="rounded-xl bg-slate-900/50 p-2 ring-1 ring-inset ring-white/10 lg:-m-4 lg:rounded-2xl lg:p-4">
              <div className="bg-slate-950 rounded-lg overflow-hidden border border-slate-800 shadow-2xl">
                <div className="flex items-center gap-2 bg-slate-900 px-4 py-2 border-b border-slate-800">
                  <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500/50"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500/50"></div>
                  <span className="text-xs text-slate-500 ml-2 mono uppercase tracking-widest">agent-appeal-schema.json</span>
                </div>
                <pre className="p-6 text-sm text-indigo-300 mono whitespace-pre-wrap">
{`{
  "id": "v1-search-api",
  "name": "GlobalSearch",
  "type": "api",
  "problem_solved": [
    "real-time data access",
    "web crawling"
  ],
  "integration": {
    "access": "api",
    "automation_friendly": true
  }
}`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
