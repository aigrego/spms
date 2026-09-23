# Next.js standalone 多阶段构建：deps 装依赖 → build 编译 → runtime 只带 .next/standalone 产物。
# BASE_IMAGE 可指向 Docker Hub 加速地址，如
#   docker build --build-arg BASE_IMAGE=docker.m.daocloud.io/library/node:22-alpine .
ARG BASE_IMAGE=node:22-alpine
# npm 镜像（corepack + pnpm 用），网络可直连 registry.npmjs.org 时无需改。
ARG NPM_REGISTRY=https://registry.npmjs.org
FROM ${BASE_IMAGE} AS base
# 每个阶段重新声明：FROM 之后全局 ARG 不在作用域内。
ARG NPM_REGISTRY
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
    npm_config_registry=${NPM_REGISTRY}
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM ${BASE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=5175
# standalone 不含 public / .next/static，需手动拷入（server.js 会自动伺服）。
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 5175
CMD ["node", "server.js"]
