# TexFlow

**https://texflow.work** — Agent-first products for the open web.

## Structure

- **TexFlow** — Brand; homepage at `/`.
- **TexMKT** — First product: Agent Appeal generation and public Agent Catalog. All under `/texmkt/`.

## Features

- **Home** (`/`) — TexFlow brand landing; link to TexMKT.
- **TexMKT** (`/texmkt/`) — Product landing for the Agent-First Marketplace.
- **Generate** (`/texmkt/generate`) — Enter a URL → Crawl4AI + Gemini → draft Agent Appeal → edit → publish (live status).
- **Publish** (`/texmkt/upload`) — Paste validated AA JSON → publish to catalog.
- **Catalog** — Full AA at `/texmkt/aa/:id`; discovery at `/texmkt/.well-known/agent-catalog.json`.
- **Discovery** — `/texmkt/.well-known/ai.json` for agents (read-only, no auth).

Legacy paths redirect to TexMKT: `/generate` → `/texmkt/generate`, `/upload` → `/texmkt/upload`, `/aa/:id` → `/texmkt/aa/:id`.

## Quick start (local)

**Node**
```bash
npm install
npm start
```

**Python (for TexMKT generate)** — Crawl4AI + Gemini (Python 3.9–3.12):
```bash
cd scripts
python3 -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
python -m playwright install   # one-time: Chromium for Crawl4AI
```
Set `GOOGLE_AI_API_KEY` in project root `.env`. Chromium installs automatically on first generate; on Linux you may need `sudo python -m playwright install-deps`.

Open http://localhost:5001 (or your configured PORT).

## Deploy on VPS (public internet)

1. **Node.js 18+** (e.g. Ubuntu 22.04):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

2. **Clone and install**
   ```bash
   cd /var/www
   git clone <your-repo> texflow.work && cd texflow.work
   npm install --production
   ```

3. **Environment**
   ```bash
   cp .env.example .env
   nano .env   # GOOGLE_AI_API_KEY=...
   ```

4. **Run with systemd**
   - `/etc/systemd/system/texflow.service`:
   ```ini
   [Unit]
   Description=TexFlow
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
   HOST=0.0.0.0

   [Install]
   WantedBy=multi-user.target
   ```
   - `sudo systemctl daemon-reload && sudo systemctl enable texflow && sudo systemctl start texflow`

5. **Reverse proxy** — Nginx (or Caddy) in front of `http://127.0.0.1:5001`; terminate TLS for `texflow.work`. Use relative URLs in the app (no localhost); the site works on any host.

## Project structure

```
/
├── server.js
├── package.json
├── public/
│   ├── index.html          # TexFlow brand homepage
│   ├── styles.css
│   ├── app.js
│   ├── mars-hero.mp4
│   └── texmkt/
│       ├── index.html      # TexMKT product landing
│       ├── generate.html
│       ├── upload.html
│       └── .well-known/
│           └── ai.json     # static; catalog is dynamic
├── scripts/
│   ├── generate_aa.py
│   └── requirements.txt
├── aa/                     # Stored Agent Appeals (aa/<id>.json)
└── .env.example
```

## TexMKT agent endpoints (no auth)

| Endpoint | Description |
|----------|-------------|
| `GET /texmkt/.well-known/ai.json` | Product purpose and catalog pointer |
| `GET /texmkt/.well-known/agent-catalog.json` | List of AAs (id, name, category, action.learn_more) |
| `GET /texmkt/aa/:id` | Full Agent Appeal JSON |

All `/texmkt/.well-known/*` requests are logged (including User-Agent).

## Agent Appeal schema (v1)

`id`, `name`, `type`, `category`, `provider`, `summary`, `problem_solved`, `capabilities`, `inputs_required`, `outputs_provided`, `pricing`, `integration`, `constraints`, `action`, `metadata`.

## License

MIT
