FROM node:22.20-alpine AS build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm eod:worker:build

FROM node:22.20-alpine
WORKDIR /app
COPY --from=build /src/services/eod-worker/dist/eod-worker.mjs /app/eod-worker.mjs
USER node
ENTRYPOINT ["node", "/app/eod-worker.mjs"]
