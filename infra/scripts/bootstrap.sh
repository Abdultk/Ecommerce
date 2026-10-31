#!/usr/bin/env bash
# First-time local setup. Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/../.."

corepack enable
pnpm install

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — fill in Stripe test keys before working on checkout."
fi

docker compose -f infra/docker-compose.yml up -d --wait postgres redis mailpit

pnpm --filter @hp/contracts build

pnpm --filter @hp/api db:migrate
pnpm --filter @hp/api db:seed

echo ""
echo "Ready."
echo "  Postgres  localhost:5442 (hp / hearthandpan)"
echo "  Redis     localhost:6389"
echo "  Mail UI   http://localhost:8035"
echo "Run 'pnpm test' to verify, then 'pnpm dev' once the apps exist."
