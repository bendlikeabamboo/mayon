FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY sidecar/package.json sidecar/
RUN pnpm install --frozen-lockfile --filter @mayon/sidecar...

COPY packages/shared packages/shared
COPY sidecar sidecar
RUN pnpm --filter @mayon/sidecar build

FROM node:22-alpine

WORKDIR /app

COPY --from=build /app/sidecar/package.json ./package.json
COPY --from=build /app/sidecar/dist ./dist

ENV PORT=4319

EXPOSE 4319

CMD ["node", "dist/server.js"]
