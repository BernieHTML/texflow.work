#!/bin/bash
set -e

echo "Deploying TexFlow..."

git pull origin main

pnpm install
pnpm build

cd packages/database && pnpm prisma migrate deploy && cd ../..

echo "Restart services (e.g. systemd or docker-compose) and run health checks."
echo "Done."
