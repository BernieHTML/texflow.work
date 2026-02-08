import { AgentAppeal } from '../types';

/**
 * Example Agent Appeal in the exact schema format required by Platform1.
 * Use as reference when pasting or constructing an AA manually.
 */
export const EXAMPLE_AGENT_APPEAL: AgentAppeal = {
  id: "example-aa-id",
  name: "Example API Service",
  type: "api",
  category: ["Developer Tools", "Automation"],
  provider: {
    name: "Example Corp",
    website: "https://example.com"
  },
  summary: "An example product or service described for AI agents. Replace with your own summary.",
  problem_solved: ["Discovery", "Integration complexity"],
  capabilities: ["REST API", "Webhooks", "Documentation"],
  inputs_required: ["API key", "Endpoint URL"],
  outputs_provided: ["JSON responses", "Event payloads"],
  pricing: {
    model: "freemium",
    free_tier: true,
    paid_tier: true
  },
  integration: {
    access: "api",
    authentication: "api_key",
    automation_friendly: true
  },
  constraints: ["Rate limits apply", "HTTPS only"],
  action: {
    learn_more: "https://example.com/docs",
    purchase: "https://example.com/pricing"
  },
  metadata: {
    created_at: "2026-02-07T00:00:00.000Z",
    updated_at: "2026-02-07T00:00:00.000Z"
  }
};
