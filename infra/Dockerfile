# NOVA API / worker image (same code, different command). No secrets baked in.
FROM node:22.12-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY lib ./lib
COPY server ./server
COPY worker ./worker
COPY api ./api
COPY sql ./sql
COPY contracts ./contracts
COPY src/data/report.json ./src/data/report.json
COPY src/data/terms.json ./src/data/terms.json
USER node
CMD ["node", "server/index.mjs"]
