'use client';

import { useEffect, useState } from 'react';

const steps = [
  { label: 'Agent discovers texflow.md', icon: '🔍' },
  { label: 'Searches catalog', icon: '📦' },
  { label: 'Adds to cart', icon: '🛒' },
  { label: 'User approves', icon: '✅' },
  { label: 'Purchase complete', icon: '🎉' },
];

export function AgentPurchaseDemo() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((s) => (s + 1) % steps.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-8 backdrop-blur">
      <div className="mb-6 text-center text-lg font-medium text-slate-300">
        Agent purchase flow
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4">
        {steps.map((step, i) => (
          <div
            key={step.label}
            className={`flex items-center gap-2 rounded-lg px-4 py-3 transition-all ${
              i === activeStep
                ? 'scale-105 border-2 border-purple-500 bg-purple-500/20 text-white'
                : 'border border-slate-600 bg-slate-800/50 text-slate-400'
            }`}
          >
            <span className="text-2xl">{step.icon}</span>
            <span className="font-medium">{step.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-center">
        <div className="flex gap-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-2 w-2 rounded-full transition-colors ${
                i === activeStep ? 'bg-purple-500' : 'bg-slate-600'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
