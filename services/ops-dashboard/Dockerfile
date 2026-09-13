FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY modules ./modules
COPY services/ops-dashboard ./services/ops-dashboard
RUN node services/ops-dashboard/build.mjs

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    QEO_OPS_PUBLIC_DIR=/app/public \
    QEO_OPS_HOST=0.0.0.0 \
    QEO_OPS_PORT=8787

COPY --from=build /repo/services/ops-dashboard/dist ./dist
COPY --from=build /repo/services/ops-dashboard/public ./public

USER node
EXPOSE 8787
CMD ["node", "dist/ops-dashboard.mjs"]
