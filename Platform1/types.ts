
export type ProductType = "software" | "service" | "api" | "dataset" | "tool";
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
