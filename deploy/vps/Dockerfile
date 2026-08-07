FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.61.1-noble AS runtime

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    OPSBOT_DATA_DIR=/app/data

WORKDIR /app

COPY --from=build --chown=pwuser:pwuser /app /app

USER pwuser

EXPOSE 3000

CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
