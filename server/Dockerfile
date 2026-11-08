FROM node:22.23.4-alpine AS build

WORKDIR /app

# better-sqlite3 is compiled from source: the musl prebuilt download is
# unreliable on CI runners and embeds a musl that may be unpatched
# (CVE-2026-107891). A source build links against the image's musl.
RUN apk add --no-cache python3 make g++
ENV npm_config_build_from_source=true
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile --filter @mayon/server...

COPY packages/shared packages/shared
RUN pnpm --filter @mayon/shared build
# Required by server/tsconfig.json path alias "@mayon/schema" -> "../src/lib/db/schema.ts"
COPY src/lib/db/schema.ts src/lib/db/schema.ts
COPY server server
RUN pnpm --filter @mayon/server build

RUN pnpm deploy --filter=@mayon/server --prod --legacy /app/deployed

FROM node:22.23.4-alpine

WORKDIR /app

COPY --from=build /app/deployed/node_modules ./node_modules
COPY --from=build /app/deployed/package.json ./package.json
COPY --from=build /app/server/dist ./dist
COPY ./drizzle ./drizzle

ENV PORT=4319

EXPOSE 4319

RUN apk add --no-cache postgresql17-client

CMD ["node", "dist/server.js"]
