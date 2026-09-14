FROM node:22-bookworm-slim AS build

WORKDIR /app

# The release checks include Python lifecycle tests.
RUN apt-get update && apt-get install -y --no-install-recommends python3 procps \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
# Runtime does not rebuild the Vite app; keep stable dependencies in their own layer.
RUN mv /app/node_modules /runtime-node_modules \
    && rm -rf /app/desktop-ui/node_modules /app/.next/cache

FROM mcr.microsoft.com/playwright:v1.61.1-noble AS runtime

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    OPSBOT_DATA_DIR=/app/data

WORKDIR /app

COPY --from=build --chown=pwuser:pwuser /runtime-node_modules /app/node_modules
COPY --from=build --chown=pwuser:pwuser /app /app

USER pwuser

EXPOSE 3000

CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
