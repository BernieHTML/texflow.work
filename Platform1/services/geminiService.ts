import { AgentAppeal } from "../types";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent";

/** JSON Schema for Agent Appeal (REST uses string types, not SDK Type enum). */
const agentAppealJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    type: { type: "string", description: "software | service | api | dataset | tool" },
    category: { type: "array", items: { type: "string" } },
    provider: {
      type: "object",
      properties: {
        name: { type: "string" },
        website: { type: "string" },
      },
      required: ["name", "website"],
    },
    summary: { type: "string" },
    problem_solved: { type: "array", items: { type: "string" } },
    capabilities: { type: "array", items: { type: "string" } },
    inputs_required: { type: "array", items: { type: "string" } },
    outputs_provided: { type: "array", items: { type: "string" } },
    pricing: {
      type: "object",
      properties: {
        model: { type: "string", description: "free | freemium | subscription | usage | one-time" },
        free_tier: { type: "boolean" },
        paid_tier: { type: "boolean" },
      },
      required: ["model", "free_tier", "paid_tier"],
    },
    integration: {
      type: "object",
      properties: {
        access: { type: "string", description: "web | api | download" },
        authentication: { type: "string", description: "none | api_key | oauth" },
        automation_friendly: { type: "boolean" },
      },
      required: ["access", "authentication", "automation_friendly"],
    },
    constraints: { type: "array", items: { type: "string" } },
    action: {
      type: "object",
      properties: {
        learn_more: { type: "string" },
        purchase: { type: "string" },
      },
      required: ["learn_more", "purchase"],
    },
    metadata: {
      type: "object",
      properties: {
        created_at: { type: "string" },
        updated_at: { type: "string" },
      },
      required: ["created_at", "updated_at"],
    },
  },
  required: [
    "id", "name", "type", "category", "provider", "summary",
    "problem_solved", "capabilities", "inputs_required",
    "outputs_provided", "pricing", "integration", "action", "metadata",
  ],
} as const;

export const generateAgentAppeal = async (url: string): Promise<AgentAppeal> => {
  const promptText =
    `Analyze the following URL and generate an Agent Appeal (AA) JSON object for the product or service found there.
The URL is: ${url}

If you cannot access the real-time data for this URL, use your internal knowledge about the product associated with this domain.
If the product is unknown, create a professional plausible placeholder based on the domain name.`.trim();

  if (!promptText) {
    throw new Error("Prompt text is empty");
  }

  const apiKey = process.env.API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing API key (API_KEY or GEMINI_API_KEY)");
  }

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: promptText }],
      },
    ],
    systemInstruction: {
      parts: [
        { text: "You are a professional product analyst. Your goal is to help AI agents understand how to use a product. Always ensure the provider website and learn_more links match the provided URL." },
      ],
    },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: agentAppealJsonSchema,
      temperature: 0.4,
      maxOutputTokens: 8192,
    },
  };

  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (text == null || text === "") {
    throw new Error("Gemini returned no text");
  }

  const aaData: AgentAppeal = JSON.parse(text);
  aaData.provider.website = url;
  aaData.action.learn_more = url;
  return aaData;
};
