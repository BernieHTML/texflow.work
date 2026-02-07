# TexFlow — Agent-First Marketplace

**https://texflow.work** — Where AI agents discover, evaluate, and act on digital products and services.

## Features

- **Landing page** — Dark, futuristic UI with hero video and logo
- **Agent Appeal (AA)** — Machine-readable JSON schema for products/services
- **Generate** (`/generate`) — Enter a URL → crawl (Crawl4AI) + AI (Gemini 1.5 Flash) → draft AA → edit → publish (with live status)
- **Upload** (`/upload`) — Paste validated AA JSON → publish to catalog
- **Catalog** — Each AA at `/aa/:id` (full JSON); discovery at `/.well-known/agent-catalog.json`
- **Discovery** — `/.well-known/ai.json` for agents (read-only, no auth)

## Quick start (local)

**Node**
```bash
npm install
npm start
```

**Python (required for /generate)** — Crawl4AI + Gemini 1.5 Flash (Python 3.9–3.12):
```bash
cd scripts
python3 -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
python -m playwright install   # one-time: install Chromium for Crawl4AI
```
Set `GOOGLE_AI_API_KEY` in the project root `.env` (copy from `.env.example`). The Node server spawns the venv’s Python and runs `generate_aa.py <url>`, streaming live status to the browser. **Chromium is installed automatically** on first generate (local or VPS); on Linux you may need `sudo python -m playwright install-deps` if the browser fails to launch.

Open http://localhost:5001

## Deploy on Ubuntu 22.04 (VPS)

1. **Node.js 18+**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

2. **Clone and install**
   ```bash
   cd /var/www  # or your app dir
   git clone <your-repo> texflow.work && cd texflow.work
   npm install --production
   ```

3. **Environment**
   ```bash
   cp .env.example .env
   nano .env   # set GOOGLE_AI_API_KEY=... (Google AI Studio / Gemini)
   ```

4. **Run with systemd** (recommended)
   - Create `/etc/systemd/system/texflow.service`:
   ```ini
   [Unit]
   Description=TexFlow Agent Marketplace
   After=network.target

   [Service]
   Type=simple
   User=www-data
   WorkingDirectory=/var/www/texflow.work
   Environment=NODE_ENV=production
   EnvironmentFile=/var/www/texflow.work/.env
   ExecStart=/usr/bin/node server.js
   Restart=on-failure
   PORT=5001

   [Install]
   WantedBy=multi-user.target
   ```
   - Then: `sudo systemctl daemon-reload && sudo systemctl enable texflow && sudo systemctl start texflow`

5. **Reverse proxy (nginx)** — Proxy to `http://127.0.0.1:5001` and terminate TLS for `texflow.work`.

## Project structure

```
/
├── server.js           # Express app, APIs, .well-known
├── package.json
├── scripts/
│   ├── generate_aa.py  # Crawl4AI + Gemini draft generator
│   └── requirements.txt
├── public/
│   ├── index.html      # Landing
│   ├── generate.html   # AA generator (live status)
│   ├── upload.html     # AA upload
│   ├── styles.css
│   └── app.js
├── aa/                 # Stored Agent Appeals (aa/<uuid>.json)
└── .env.example
```

## Agent endpoints (no auth)

| Endpoint | Description |
|----------|-------------|
| `GET /.well-known/ai.json` | Site purpose and catalog pointer |
| `GET /.well-known/agent-catalog.json` | List of AAs (id, name, category, action.learn_more) |
| `GET /aa/:id` | Full Agent Appeal JSON |

All `.well-known` requests are logged (including User-Agent) to stdout.

## Agent Appeal schema (v1)

See the spec in the codebase: `id`, `name`, `type`, `category`, `provider`, `summary`, `problem_solved`, `capabilities`, `inputs_required`, `outputs_provided`, `pricing`, `integration`, `constraints`, `action`, `metadata`.

## License

MIT
