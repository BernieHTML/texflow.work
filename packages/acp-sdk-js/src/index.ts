export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  permissions: string[];
}

export class TexFlowAgentClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://api.texflow.work/v2') {
    this.baseUrl = baseUrl;
  }

  async getToken(
    agentId: string,
    userConsentToken: string,
    scope: string[] = ['read', 'purchase', 'track']
  ): Promise<TokenResponse> {
    const res = await fetch(`${this.baseUrl}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentId,
        user_consent_token: userConsentToken,
        scope,
      }),
    });
    if (!res.ok) throw new Error(`Auth failed: ${res.statusText}`);
    return res.json() as Promise<TokenResponse>;
  }

  async search(accessToken: string, query: string, limit = 20): Promise<{ results: unknown[] }> {
    const url = new URL(`${this.baseUrl}/search/semantic`);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit));
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
    return res.json();
  }
}
