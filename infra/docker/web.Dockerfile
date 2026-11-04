# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @ce/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG VITE_API_URL=/api/v1
ARG VITE_PLATFORM_ROOT_DOMAIN=lvh.me
ENV VITE_API_URL=$VITE_API_URL VITE_PLATFORM_ROOT_DOMAIN=$VITE_PLATFORM_ROOT_DOMAIN
RUN cd apps/web && pnpm build

FROM nginx:1.27-alpine
COPY infra/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
