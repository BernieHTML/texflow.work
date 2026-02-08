import React, { useState } from 'react';
import { generateAgentAppeal } from '../services/geminiService';
import { AgentAppeal } from '../types';
import { EXAMPLE_AGENT_APPEAL } from '../constants/exampleAA';
import ProductTypeSlider, { productKindToTypeAndCategory, type ProductKind } from './ProductTypeSlider';

interface OnboardingProps {
  onAASaved: (aa: AgentAppeal) => void;
}

const REQUIRED_TOP_LEVEL = ['name', 'type', 'category', 'provider', 'summary', 'problem_solved', 'capabilities', 'inputs_required', 'outputs_provided', 'pricing', 'integration', 'constraints', 'action'] as const;
const PRODUCT_TYPES = ['software', 'service', 'api', 'dataset', 'tool', 'hardware'];
const PRICING_MODELS = ['free', 'freemium', 'subscription', 'usage', 'one-time'];
const ACCESS_TYPES = ['web', 'api', 'download'];
const AUTH_TYPES = ['none', 'api_key', 'oauth'];

function validateAndNormalizePaste(obj: unknown): { ok: true; aa: AgentAppeal } | { ok: false; error: string } {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'Invalid: not a JSON object' };
  const raw = obj as Record<string, unknown>;
  for (const key of REQUIRED_TOP_LEVEL) {
    if (raw[key] === undefined) return { ok: false, error: `Missing required field: ${key}` };
  }
  if (!Array.isArray(raw.category)) return { ok: false, error: 'category must be an array of strings' };
  if (!Array.isArray(raw.problem_solved)) return { ok: false, error: 'problem_solved must be an array' };
  if (!Array.isArray(raw.capabilities)) return { ok: false, error: 'capabilities must be an array' };
  if (!Array.isArray(raw.inputs_required)) return { ok: false, error: 'inputs_required must be an array' };
  if (!Array.isArray(raw.outputs_provided)) return { ok: false, error: 'outputs_provided must be an array' };
  if (!Array.isArray(raw.constraints)) return { ok: false, error: 'constraints must be an array' };
  if (!PRODUCT_TYPES.includes(raw.type as string)) return { ok: false, error: `type must be one of: ${PRODUCT_TYPES.join(', ')}` };
  const provider = raw.provider as Record<string, unknown>;
  if (!provider?.name || typeof provider.name !== 'string') return { ok: false, error: 'provider.name is required (string)' };
  if (!provider?.website || typeof provider.website !== 'string') return { ok: false, error: 'provider.website is required (string)' };
  const pricing = raw.pricing as Record<string, unknown>;
  if (!pricing?.model || !PRICING_MODELS.includes(pricing.model as string)) return { ok: false, error: `pricing.model must be one of: ${PRICING_MODELS.join(', ')}` };
  if (typeof pricing.free_tier !== 'boolean') return { ok: false, error: 'pricing.free_tier must be boolean' };
  if (typeof pricing.paid_tier !== 'boolean') return { ok: false, error: 'pricing.paid_tier must be boolean' };
  const integration = raw.integration as Record<string, unknown>;
  if (!integration?.access || !ACCESS_TYPES.includes(integration.access as string)) return { ok: false, error: `integration.access must be one of: ${ACCESS_TYPES.join(', ')}` };
  if (!integration?.authentication || !AUTH_TYPES.includes(integration.authentication as string)) return { ok: false, error: `integration.authentication must be one of: ${AUTH_TYPES.join(', ')}` };
  if (typeof integration.automation_friendly !== 'boolean') return { ok: false, error: 'integration.automation_friendly must be boolean' };
  const action = raw.action as Record<string, unknown>;
  if (!action?.learn_more || typeof action.learn_more !== 'string') return { ok: false, error: 'action.learn_more is required (string)' };
  if (!action?.purchase || typeof action.purchase !== 'string') return { ok: false, error: 'action.purchase is required (string)' };

  const now = new Date().toISOString();
  const aa: AgentAppeal = {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : crypto.randomUUID?.() ?? `manual-${Date.now()}`,
    name: String(raw.name),
    type: raw.type as AgentAppeal['type'],
    category: (raw.category as string[]).map(String),
    provider: { name: String(provider.name), website: String(provider.website) },
    summary: String(raw.summary),
    problem_solved: (raw.problem_solved as string[]).map(String),
    capabilities: (raw.capabilities as string[]).map(String),
    inputs_required: (raw.inputs_required as string[]).map(String),
    outputs_provided: (raw.outputs_provided as string[]).map(String),
    pricing: {
      model: pricing.model as AgentAppeal['pricing']['model'],
      free_tier: Boolean(pricing.free_tier),
      paid_tier: Boolean(pricing.paid_tier)
    },
    integration: {
      access: integration.access as AgentAppeal['integration']['access'],
      authentication: integration.authentication as AgentAppeal['integration']['authentication'],
      automation_friendly: Boolean(integration.automation_friendly)
    },
    constraints: (raw.constraints as string[]).map(String),
    action: { learn_more: String(action.learn_more), purchase: String(action.purchase) },
    metadata: {
      created_at: (raw.metadata as Record<string, string> | undefined)?.created_at ?? now,
      updated_at: (raw.metadata as Record<string, string> | undefined)?.updated_at ?? now
    }
  };
  return { ok: true, aa };
}

const Onboarding: React.FC<OnboardingProps> = ({ onAASaved }) => {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [generatedAA, setGeneratedAA] = useState<AgentAppeal | null>(null);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [pastedJson, setPastedJson] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [showExample, setShowExample] = useState(false);
  const [productKind, setProductKind] = useState<ProductKind>('digital');

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

  function applyProductKindToAA(aa: AgentAppeal): AgentAppeal {
    const { type, category } = productKindToTypeAndCategory(productKind);
    const existingCategories = aa.category || [];
    const categorySet = new Set([category, ...existingCategories.filter(c => c !== category)]);
    return {
      ...aa,
      type,
      category: Array.from(categorySet),
    };
  }

  const handleApproveGenerated = () => {
    if (generatedAA) onAASaved(applyProductKindToAA(generatedAA));
  };

  const handlePasteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPasteError('');
    const trimmed = pastedJson.trim();
    if (!trimmed) {
      setPasteError('Paste a JSON Agent Appeal first.');
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      const result = validateAndNormalizePaste(parsed);
      if (result.ok) {
        onAASaved(applyProductKindToAA(result.aa));
      } else {
        setPasteError(result.error);
      }
    } catch {
      setPasteError('Invalid JSON. Check syntax and try again.');
    }
  };

  const handleUseExample = () => {
    setPastedJson(JSON.stringify(EXAMPLE_AGENT_APPEAL, null, 2));
    setPasteError('');
  };

  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold text-white mb-4">Onboard Your Product</h2>
        <p className="text-slate-400">Generate an Agent Appeal from a URL, or paste an AA JSON in the exact schema format.</p>
      </div>

      {/* Example schema (exact AA format) */}
      <div className="mb-10 bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowExample(!showExample)}
          className="w-full px-6 py-4 flex items-center justify-between text-left text-slate-300 hover:bg-slate-800/50 transition-colors"
        >
          <span className="font-semibold">Example schema (exact AA format)</span>
          <span className="text-slate-500">{showExample ? '▼' : '▶'}</span>
        </button>
        {showExample && (
          <div className="border-t border-slate-800 px-6 pb-6 pt-2">
            <p className="text-slate-500 text-sm mb-2">Use this structure when pasting or building an AA manually. All fields are required.</p>
            <pre className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-sm text-emerald-400/90 mono whitespace-pre-wrap overflow-x-auto max-h-80 overflow-y-auto">
              {JSON.stringify(EXAMPLE_AGENT_APPEAL, null, 2)}
            </pre>
          </div>
        )}
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
            <div className="mb-6">
              <ProductTypeSlider value={productKind} onChange={setProductKind} />
            </div>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-white">Generated Agent Appeal</h3>
              <button
                onClick={handleApproveGenerated}
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

        {/* Add AA manually by pasting JSON */}
        <div className="mt-12 pt-10 border-t border-slate-800">
          <h3 className="text-lg font-semibold text-white mb-2">Add manually</h3>
          <p className="text-slate-500 text-sm mb-4">Paste a complete Agent Appeal JSON in the exact schema format. Id and metadata are optional (they will be generated if missing).</p>
          <div className="mb-4">
            <ProductTypeSlider value={productKind} onChange={setProductKind} />
          </div>
          <form onSubmit={handlePasteSubmit} className="space-y-4">
            <textarea
              value={pastedJson}
              onChange={(e) => setPastedJson(e.target.value)}
              placeholder='{"name":"My Product","type":"software",...}'
              rows={10}
              className="block w-full rounded-md bg-slate-950 border border-slate-700 px-4 py-3 text-sm text-slate-300 font-mono placeholder-slate-600 focus:border-indigo-500 focus:ring-indigo-500"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-6 rounded-md transition-all"
              >
                Validate & Add to Catalog
              </button>
              <button
                type="button"
                onClick={handleUseExample}
                className="bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium py-2 px-4 rounded-md transition-all"
              >
                Fill with example schema
              </button>
            </div>
            {pasteError && <p className="text-red-400 text-sm bg-red-900/20 p-3 rounded border border-red-900/50">{pasteError}</p>}
          </form>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
