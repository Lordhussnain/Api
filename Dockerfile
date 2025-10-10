# Dockerfile.dev
FROM node:20-bullseye-slim
WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl build-essential python3 make g++ libvips-dev \
 && npm install -g pnpm \
 && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./

# Install only so pnpm CLI and cache exist (we'll re-run install at container start if mounted)
RUN pnpm install --frozen-lockfile --ignore-scripts=false || true

COPY . .

ENV NODE_ENV=development
EXPOSE 3000

# Ensure idempotent: install if node_modules missing and generate prisma client
CMD sh -c "\
  if [ ! -d node_modules ]; then pnpm install --frozen-lockfile; fi && \
  if [ ! -f node_modules/.prisma/client/default ]; then pnpm prisma generate; fi && \
  pnpm run dev"
