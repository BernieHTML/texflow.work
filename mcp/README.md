# TexMKT MCP Server

Model Context Protocol (MCP) server exposing TexMKT as tools for Claude Desktop. Uses **Streamable HTTP** transport so Claude Desktop on your local Mac can connect to the MCP server running on the VPS over the network.

## Tools

| Tool | Description |
|------|-------------|
| `texmkt_match` | Search for products by natural-language goal. Costs $0.10/query from prepaid credits. |
| `texmkt_topup` | Get a Stripe checkout URL to top up query credits. |
| `texmkt_browse_merchants` | List all registered merchants and their catalog endpoints. |

## Setup

### On the VPS

1. **Install dependencies** (if not already done):
   ```bash
   cd /path/to/texflow.work
   npm install
   ```

2. **Install and enable the systemd service**:
   ```bash
   sudo cp etc/texmkt-mcp.service /etc/systemd/system/
   sudo systemctl enable texmkt-mcp
   sudo systemctl start texmkt-mcp
   ```

3. **Add the Nginx location block** (if not already present):
   - Ensure `etc/nginx-texflow.conf` includes the `/mcp` location block and `texmkt-mcp` upstream.
   - Reload Nginx: `sudo nginx -s reload`

4. **Verify the endpoint is live**:
   ```bash
   curl -X POST https://texflow.work/mcp \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
   ```
   You should see an SSE-style response with `event: message` and server info.

### On your local Mac

1. **Add the MCP config** to Claude Desktop:
   - Open or create `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Merge the contents of `mcp/texmkt-mcp-config.json` into your config. If you have other MCP servers, add the `texmkt` entry under `mcpServers`:
   ```json
   {
     "mcpServers": {
       "texmkt": {
         "type": "http",
         "url": "https://texflow.work/mcp"
       }
     }
   }
   ```

2. **Restart Claude Desktop**

3. **Test** by asking Claude: *"Search TexMKT for a nature-inspired fragrance gift under $200"*

   Claude will use the `texmkt_match` tool. You’ll need credits first — use `texmkt_topup` or seed credits via `POST https://texflow.work/texmkt/api/credits/seed` for testing.

## Running locally (development)

```bash
npm run mcp
```

The MCP server listens on port 5002. For local Claude Desktop testing, point the config to `http://localhost:5002/mcp` instead of `https://texflow.work/mcp`.
