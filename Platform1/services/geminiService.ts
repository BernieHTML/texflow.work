
import { GoogleGenAI, Type } from "@google/genai";
import { AgentAppeal } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

export const generateAgentAppeal = async (url: string): Promise<AgentAppeal> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze the following URL and generate an Agent Appeal (AA) JSON object for the product or service found there. 
    The URL is: ${url}
    
    If you cannot access the real-time data for this URL, use your internal knowledge about the product associated with this domain. 
    If the product is unknown, create a professional plausible placeholder based on the domain name.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          name: { type: Type.STRING },
          type: { type: Type.STRING, description: "software | service | api | dataset | tool" },
          category: { type: Type.ARRAY, items: { type: Type.STRING } },
          provider: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              website: { type: Type.STRING },
            },
            required: ["name", "website"]
          },
          summary: { type: Type.STRING },
          problem_solved: { type: Type.ARRAY, items: { type: Type.STRING } },
          capabilities: { type: Type.ARRAY, items: { type: Type.STRING } },
          inputs_required: { type: Type.ARRAY, items: { type: Type.STRING } },
          outputs_provided: { type: Type.ARRAY, items: { type: Type.STRING } },
          pricing: {
            type: Type.OBJECT,
            properties: {
              model: { type: Type.STRING, description: "free | freemium | subscription | usage | one-time" },
              free_tier: { type: Type.BOOLEAN },
              paid_tier: { type: Type.BOOLEAN },
            },
            required: ["model", "free_tier", "paid_tier"]
          },
          integration: {
            type: Type.OBJECT,
            properties: {
              access: { type: Type.STRING, description: "web | api | download" },
              authentication: { type: Type.STRING, description: "none | api_key | oauth" },
              automation_friendly: { type: Type.BOOLEAN },
            },
            required: ["access", "authentication", "automation_friendly"]
          },
          constraints: { type: Type.ARRAY, items: { type: Type.STRING } },
          action: {
            type: Type.OBJECT,
            properties: {
              learn_more: { type: Type.STRING },
              purchase: { type: Type.STRING },
            },
            required: ["learn_more", "purchase"]
          },
          metadata: {
            type: Type.OBJECT,
            properties: {
              created_at: { type: Type.STRING },
              updated_at: { type: Type.STRING },
            },
            required: ["created_at", "updated_at"]
          }
        },
        required: [
          "id", "name", "type", "category", "provider", "summary", 
          "problem_solved", "capabilities", "inputs_required", 
          "outputs_provided", "pricing", "integration", "action", "metadata"
        ]
      },
      systemInstruction: "You are a professional product analyst. Your goal is to help AI agents understand how to use a product. Always ensure the provider website and learn_more links match the provided URL."
    }
  });

  const aaData: AgentAppeal = JSON.parse(response.text);
  // Ensure the URL matches what was provided
  aaData.provider.website = url;
  aaData.action.learn_more = url;
  return aaData;
};
