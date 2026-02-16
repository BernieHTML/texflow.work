# TexFlow

**https://texflow.work** — SaaS platform that makes any e-commerce website agent-ready via the **Agentic Commerce Protocol (ACP)**. AI agents (Claude, GPT-4, etc.) can discover catalogs and execute purchases on behalf of users.

## Monorepo structure

```
texflow.work/
├── apps/
│   ├── web/           # Marketing site (Next.js 14, port 3000)
│   ├── dashboard/     # Merchant dashboard (Next.js 14, port 3001)
│   ├── api/           # Core API (Express, port 4000)
│   └── agent-api/     # Agent-facing API gateway (port 4001)
├── packages/
│   ├── ui/            # Shared React UI components
│   ├── database/      # Prisma schema & client
│   ├── acp-sdk-js/    # JavaScript SDK for agents
│   ├── acp-sdk-python/# Python SDK for agents
│   └── merchant-sdk/   # SDK for merchant integrations
├── services/
│   ├── catalog-sync/  # Product catalog sync
│   ├── webhook-dispatcher/
│   └── analytics/
├── infrastructure/
│   ├── nginx/
│   ├── docker/
│   └── scripts/
└── docs/
    ├── acp-specification.md
    └── api-reference.md
```

## Quick start

**Prerequisites**: Node.js 20+, pnpm 9 (or use `npx pnpm` for any command).

```bash
pnpm install
pnpm db:generate   # Generate Prisma client
```

**Database** (Docker):

```bash
cd infrastructure/docker && docker compose up -d postgres redis
```

Set `DATABASE_URL` in `.env` (see `.env.example`).

**Run apps**:

```bash
pnpm dev:web        # Marketing site → http://localhost:3000
pnpm dev:dashboard  # Dashboard → http://localhost:3001
pnpm dev:api        # API → http://localhost:4000
```

Or from app directories:

```bash
pnpm --filter @texflow/web dev
pnpm --filter @texflow/dashboard dev
pnpm --filter @texflow/api dev
```

**Migrations**:

```bash
pnpm db:push    # Dev: push schema
pnpm db:migrate # Prod: run migrations
```

---

## Run locally (testing)

Minimal steps to run everything on your machine:

**1. Install dependencies** (use `npx pnpm` if you don’t have pnpm installed globally)

```bash
npx pnpm install
```

**2. Start PostgreSQL** (pick one)

- **Docker** (if you have it): from repo root,
  ```bash
  cd infrastructure/docker && docker compose up -d postgres && cd ../..
  ```
- **No Docker – use Homebrew** (Mac):
  ```bash
  brew install postgresql@16
  brew services start postgresql@16
  createuser -s texflow   # create user (or use your Mac username)
  createdb texflow       # create database
  ```
  Then in `.env` use: `DATABASE_URL="postgresql://texflow@localhost:5432/texflow"` (no password) or, if you set a password, `postgresql://texflow:YOUR_PASSWORD@localhost:5432/texflow`.
- **Local Postgres already installed**: ensure a database exists (e.g. `createdb texflow`) and set `DATABASE_URL` in `.env` to match.

**3. Environment**

```bash
cp .env.example .env
```

Edit `.env` and set at least:

- `DATABASE_URL` — e.g. `postgresql://texflow:texflow@localhost:5432/texflow` (Docker default user/pass are in `infrastructure/docker/docker-compose.yml`; default DB name is `texflow`).
- `JWT_SECRET` — any string for local testing (e.g. `dev-secret`).

**4. Database schema**

```bash
npx pnpm db:generate
npx pnpm db:push
```

(`db:push` creates/updates tables without migration files; fine for local testing.)

**5. Run the apps** (use 3 terminals, or one with background jobs)

Terminal 1 – marketing site:

```bash
npx pnpm dev:web
```

→ **http://localhost:3000**

Terminal 2 – merchant dashboard:

```bash
npx pnpm dev:dashboard
```

→ **http://localhost:3001**

Terminal 3 – API:

```bash
npx pnpm dev:api
```

→ **http://localhost:4000** (e.g. **http://localhost:4000/health**)

**Optional**: Run all three in one terminal (Unix):

```bash
npx pnpm dev:web & npx pnpm dev:dashboard & npx pnpm dev:api & wait
```

**Testing the API**: The API needs at least one **Merchant** in the DB to generate `texflow.md` or use auth. You can create one via Prisma Studio (`npx pnpm db:studio`) or a one-off script.

## Environment

Copy `.env.example` to `.env` and set at least:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Secret for agent tokens

## Docs

- [ACP Specification](docs/acp-specification.md)
- [API Reference](docs/api-reference.md)

## License

MIT
