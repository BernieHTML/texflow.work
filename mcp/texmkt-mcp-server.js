#!/usr/bin/env node
/**
 * TexMKT MCP Server — HTTP-based, reachable by Claude Desktop over the network.
 * Runs on port 5002 (separate from main Express on 5001).
 * Thin wrapper: all logic delegates to https://texflow.work TexMKT API.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import * as z from 'zod';

const TEXMKT_BASE = 'https://texflow.work';

function createServer() {
  const server = new McpServer(
    { name: 'texmkt', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool('texmkt_match', {
    description: "Search for physical products by goal. Submit a natural language goal and receive ranked product matches from TexMKT's merchant catalog. Costs $0.10 per query from your prepaid credit balance.",
    inputSchema: {
      agent_id: z.string().describe('Your agent identifier'),
      goal: z.string().describe('What you are trying to find or accomplish'),
      budget_usd: z.number().optional().describe('Optional maximum price in USD'),
      merchant_slug: z.string().optional().describe('Optional — filter to one merchant'),
    },
  }, async ({ agent_id, goal, budget_usd, merchant_slug }) => {
    const body = { agent_id, goal };
    if (budget_usd != null) body.budget_usd = budget_usd;
    if (merchant_slug != null) body.merchant_slug = merchant_slug;
    const res = await fetch(`${TEXMKT_BASE}/texmkt/api/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return {
      content: [{ type: 'text', text: JSON.stringify(json, null, 2) }],
    };
  });

  server.registerTool('texmkt_topup', {
    description: 'Get a Stripe payment URL to top up your TexMKT query credits. Each match query costs $0.10.',
    inputSchema: {
      agent_id: z.string().describe('Your agent identifier'),
      amount_usd: z.number().describe('Amount in USD to top up (min $1.00)'),
    },
  }, async ({ agent_id, amount_usd }) => {
    const res = await fetch(`${TEXMKT_BASE}/texmkt/api/credits/topup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id, amount_usd }),
    });
    const json = await res.json();
    return {
      content: [{ type: 'text', text: JSON.stringify(json, null, 2) }],
    };
  });

  server.registerTool('texmkt_browse_merchants', {
    description: 'List all merchants currently registered on TexMKT and their catalog endpoints.',
    inputSchema: {},
  }, async () => {
    const res = await fetch(`${TEXMKT_BASE}/texmkt/api/merchants`);
    const json = await res.json();
    return {
      content: [{ type: 'text', text: JSON.stringify(json, null, 2) }],
    };
  });

  return server;
}

const app = createMcpExpressApp({ host: '0.0.0.0' });

app.post('/mcp', async (req, res) => {
  const server = createServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      server.close();
    });
  } catch (err) {
    console.error('[TexMKT MCP] Error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

app.get('/mcp', (req, res) => {
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  }));
});

app.delete('/mcp', (req, res) => {
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  }));
});

const PORT = 5002;
app.listen(PORT, (err) => {
  if (err) {
    console.error('Failed to start TexMKT MCP server:', err);
    process.exit(1);
  }
  console.log(`TexMKT MCP server listening on port ${PORT} (POST /mcp)`);
});

process.on('SIGINT', () => {
  console.log('Shutting down TexMKT MCP server...');
  process.exit(0);
});
