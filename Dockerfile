# 构建期代理：由 docker-compose.yml 的 build.args 注入，留空即直连。
# apt、npm、Next.js 构建期下载字体都会读取这些变量（apt 只认小写形式）。
# 每个 stage 都要重新声明一次 ARG 才在该 stage 内可见。

# ---- 依赖安装 ----
FROM node:22-bookworm-slim AS deps
ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV http_proxy=$HTTP_PROXY \
    https_proxy=$HTTPS_PROXY \
    HTTP_PROXY=$HTTP_PROXY \
    HTTPS_PROXY=$HTTPS_PROXY \
    no_proxy=localhost,127.0.0.1,::1 \
    NO_PROXY=localhost,127.0.0.1,::1
WORKDIR /app
# better-sqlite3 在缺少预编译包时需要现场编译
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- 构建 Next.js ----
FROM node:22-bookworm-slim AS builder
ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV http_proxy=$HTTP_PROXY \
    https_proxy=$HTTPS_PROXY \
    HTTP_PROXY=$HTTP_PROXY \
    HTTPS_PROXY=$HTTPS_PROXY \
    no_proxy=localhost,127.0.0.1,::1 \
    NO_PROXY=localhost,127.0.0.1,::1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 构建期不需要真实数据库，DATABASE_PATH 指向临时文件即可
ENV DATABASE_PATH=/tmp/build.db
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 运行时：web 与 worker 共用同一镜像，靠 command 区分 ----
FROM node:22-bookworm-slim AS runner
# 这里不用 ENV：代理只在下面两条联网安装命令里临时生效，
# 避免残留到最终镜像把运行期的 localhost / 内网请求也导去代理。
ARG HTTP_PROXY
ARG HTTPS_PROXY
WORKDIR /app

RUN export http_proxy=$HTTP_PROXY https_proxy=$HTTPS_PROXY no_proxy=localhost,127.0.0.1,::1 \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# worker 直接跑 TS 源码，因此生产依赖里同样保留 tsx 与源码目录
COPY package.json package-lock.json ./
RUN export http_proxy=$HTTP_PROXY https_proxy=$HTTPS_PROXY no_proxy=localhost,127.0.0.1,::1 \
    && npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/reference ./reference

# 启动时先补迁移再拉起进程：首次部署空库也能自愈
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npm", "run", "start"]
