# TexFlow

**https://texflow.work** — Agent-first products for the open web.

## Structure

- **TexFlow** — Brand; homepage at `/`.
- **TexMKT** — Agent Appeal generation and public Agent Catalog. All under `/texmkt/`.
- **Platform66** — Agent Discovery Hub (Vy/agent onboarding, catalog, .well-known preview). SPA at `/platform66/`.
- **VyEx** — Curated base knowledge/preambles for Vy desktop agents. Marketplace at `/vyex/`; catalog at `/.well-known/vyex.json`. Free and paid experts (Stripe); ACP-compatible.

## Features

- **Home** (`/`) — TexFlow brand landing; links to TexMKT and Platform66.
- **TexMKT** (`/texmkt/`) — Product landing for the Agent-First Marketplace.
- **Platform66** (`/platform66/`) — Client-side Agent Discovery Hub: onboard products (Gemini-powered AA), catalog, .well-known preview. Build with `npm run build:platform66`; then the server serves it from `Platform66/dist`.
- **Generate** (`/texmkt/generate`) — Enter a URL → Crawl4AI + Gemini → draft Agent Appeal → edit → publish (live status).
- **Publish** (`/texmkt/upload`) — Paste validated AA JSON → publish to catalog.
- **Catalog** — Full AA at `/texmkt/aa/:id`; discovery at `/texmkt/.well-known/agent-catalog.json`.
- **Discovery** — `/texmkt/.well-known/ai.json` for agents (read-only, no auth).

Legacy paths redirect to TexMKT: `/generate` → `/texmkt/generate`, `/upload` → `/texmkt/upload`, `/aa/:id` → `/texmkt/aa/:id`.

### VyEx

- **Home** (`/vyex/`) — List public experts (cards, filter by category, search). Submit at `/vyex/create`.
- **Expert detail** (`/vyex/expert/:id`) — Full description, use cases, author. Free: "Copy Base Knowledge"; paid: Stripe checkout.
- **Catalog** — Public JSON (ACP-Version: 1.0): `GET /.well-known/vyex.json` or `GET /vyex/api/catalog` (same response).
- **Preamble** (`GET /vyex/expert/:id/preamble`) — Plain-text base knowledge. Free: 200; paid: requires `?access_token=...` or 402 + `checkout_url`.
- **Checkout** (`GET /vyex/expert/:id/checkout`) — Redirects to Stripe Checkout. Success → `/vyex/expert/:id/success?session_id=...`.
- **Webhook** (`POST /webhooks/stripe`) — Stripe `checkout.session.completed`; records order and access token in `data/orders.json`.

Data: `data/experts.json`, `data/orders.json`. Seed 5 free experts on first run if empty, or `node scripts/seed-vyex.js`. Env: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `BASE_URL`.

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

To include **Platform66**, build it once: `npm run build:platform66`. Then open http://localhost:5001 (or your configured PORT).

**VyEx** uses the same Node app: no extra install or build. Run `npm install` (installs Stripe, etc.) and `npm start`. The marketplace is served at `/vyex/`; there is no separate build command for VyEx.

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
   nano .env   # GOOGLE_AI_API_KEY, VyEx: STRIPE_*, BASE_URL
   ```

4. **Data (VyEx)** — Ensure `data/` exists and is writable. On first start the app seeds 5 free experts if `data/experts.json` is empty. Optional: `node scripts/seed-vyex.js`.

5. **Run with systemd**
   - Copy or use `etc/texflow.service`; install to `/etc/systemd/system/texflow.service`:
   ```ini
   [Unit]
   Description=TexFlow (incl. VyEx)
   After=network.target

   [Service]
   Type=simple
   User=www-data
   WorkingDirectory=/var/www/texflow.work
   Environment=NODE_ENV=production
   EnvironmentFile=/var/www/texflow.work/.env
   ExecStart=/usr/bin/node server.js
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```
   - `sudo systemctl daemon-reload && sudo systemctl enable texflow && sudo systemctl start texflow`

6. **Reverse proxy** — Nginx (or Caddy) in front of `http://127.0.0.1:5001`; terminate TLS for `texflow.work`. Use `etc/nginx-texflow.conf` as reference; ensure `/.well-known/` is proxied to the app so `/.well-known/vyex.json` is served by Node.

**Production URLs (texflow.work)** — The codebase is configured for **https://texflow.work**:
- Homepage: `https://texflow.work/`
- Platform66: `https://texflow.work/platform66/`
- VyEx: `https://texflow.work/vyex/` · Catalog: `https://texflow.work/.well-known/vyex.json`
- Discovery: `https://texflow.work/.well-known/ai.json`
- Product catalog: `https://texflow.work/.well-known/agent-catalog.json`
- Platform66 API upload: `https://texflow.work/platform66/api/upload`
All canonical, Open Graph and Twitter meta tags, and `.well-known/ai.json` product URLs use this domain. In-app links use relative paths so they resolve correctly on the deployed host. Set `BASE_URL=https://texflow.work` in `.env` for VyEx catalog and checkout URLs.

## Project structure

```
/
├── server.js
├── package.json
├── Platform66/               # Agent Discovery Hub (Vite/React SPA)
│   ├── dist/                # built output (after npm run build:platform66)
│   ├── components/
│   └── ...
├── public/
│   ├── index.html          # TexFlow brand homepage
│   ├── styles.css
│   ├── app.js
│   ├── mars-hero.mp4
│   ├── texmkt/
│   │   ├── index.html      # TexMKT product landing
│   │   ├── generate.html
│   │   ├── upload.html
│   │   └── .well-known/
│   │       └── ai.json     # static; catalog is dynamic
│   └── vyex/               # VyEx marketplace UI
│       ├── index.html
│       ├── expert.html
│       ├── create.html
│       ├── success.html
│       ├── vyex.css
│       └── vyex.js
├── data/
│   ├── experts.json        # VyEx (flat file)
│   └── orders.json         # Orders / access tokens
├── scripts/
│   ├── generate_aa.py
│   ├── seed-vyex.js
│   └── requirements.txt
├── etc/
│   ├── texflow.service     # systemd unit
│   └── nginx-texflow.conf  # Nginx reverse proxy
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
