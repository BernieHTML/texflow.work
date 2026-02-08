
export type ProductType = "software" | "service" | "api" | "dataset" | "tool" | "hardware";
export type PricingModel = "free" | "freemium" | "subscription" | "usage" | "one-time";
export type AccessType = "web" | "api" | "download";
export type AuthType = "none" | "api_key" | "oauth";

export interface AgentAppeal {
  id: string;
  name: string;
  type: ProductType;
  category: string[];
  provider: {
    name: string;
    website: string;
  };
  summary: string;
  problem_solved: string[];
  capabilities: string[];
  inputs_required: string[];
  outputs_provided: string[];
  pricing: {
    model: PricingModel;
    free_tier: boolean;
    paid_tier: boolean;
  };
  integration: {
    access: AccessType;
    authentication: AuthType;
    automation_friendly: boolean;
  };
  constraints: string[];
  action: {
    learn_more: string;
    purchase: string;
  };
  metadata: {
    created_at: string;
    updated_at: string;
  };
}

export interface CatalogEntry {
  category: string;
  products: AgentAppeal[];
}

/** Platform1 /.well-known/ai.json descriptor */
export interface Platform1AiJson {
  site: string;
  product: string;
  purpose: string;
  intended_audience: string[];
  catalog: string;
  capabilities?: string[];
  endpoints?: { discovery?: string; catalog?: string };
  interaction?: { type: string; authentication: string };
}

/** Response from /.well-known/agent-catalog.json */
export interface AgentCatalogResponse {
  updated_at: string;
  count: number;
  agent_appeals: AgentAppeal[];
}
