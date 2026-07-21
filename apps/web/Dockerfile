# Node.js base image  
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch

# Development image
FROM base AS dev
ENV NODE_ENV=development
RUN pnpm install --offline --frozen-lockfile
COPY . .
CMD ["pnpm", "dev"]
