export interface Product {
  sku: string;
  name: string;
  description: string;
  basePrice: number;
  currency?: string;
  category: string;
  stockQuantity?: number;
  images?: string[];
  specifications?: Record<string, unknown>;
  tags?: string[];
}

export interface SyncResult {
  synced: number;
  errors?: string[];
}

export class TexFlowClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: { apiKey: string; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.texflow.work/v2';
  }

  async syncCatalog(products: Product[]): Promise<SyncResult> {
    const response = await fetch(`${this.baseUrl}/catalog/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ products }),
    });
    if (!response.ok) {
      throw new Error(`Sync failed: ${response.statusText}`);
    }
    return response.json() as Promise<SyncResult>;
  }
}
