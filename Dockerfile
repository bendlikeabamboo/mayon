FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable
RUN corepack prepare pnpm@10.15.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile --filter mayon...

COPY packages/shared/ packages/shared/
RUN pnpm --filter @mayon/shared build

COPY . .
RUN pnpm build

FROM nginx:alpine

COPY --from=build /app/build /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

RUN mkdir -p /var/cache/nginx && chown -R nginx:nginx /var/cache/nginx /run

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/ || exit 1

USER nginx
