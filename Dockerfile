FROM node:20-bullseye-slim
WORKDIR /usr/src/app

# Install system deps + pnpm globally
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
 && npm install -g pnpm \
 && rm -rf /var/lib/apt/lists/*

# Copy only dependency files first (for better caching)
COPY package.json pnpm-lock.yaml ./

# Install dependencies and generate prisma client
RUN pnpm install --frozen-lockfile \
 && pnpm prisma generate

# Copy app source
COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]
