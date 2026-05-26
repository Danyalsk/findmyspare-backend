FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Render injects PORT at runtime; default to 8000
ENV PORT=8000
ENV NODE_ENV=production

EXPOSE 8000

CMD ["bun", "run", "src/index.ts"]
