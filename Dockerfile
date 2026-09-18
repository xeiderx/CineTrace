# 构建期代理：由 docker-compose.yml 的 build.args 注入，留空即直连。
# 需要联网的只有 apt 与 npm（字体已本地化在 public/fonts，不再请求 Google）。
# apt 只认小写形式的代理变量。
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
# 把 APT_MIRROR 指向镜像站（只填主机名，如 mirrors.tuna.tsinghua.edu.cn）。
# 即使有代理也建议填：代理转发 deb.debian.org 大文件时偶发 502，走国内镜像更稳更快。
ARG APT_MIRROR
# better-sqlite3 在缺少预编译包时需要现场编译。
# 镜像站在国内，走直连比绕代理快得多，所以填了 APT_MIRROR 就在本次 RUN 内临时摘掉代理。
# Acquire::Retries 让单个包偶发 502 时自动重试，而不是整个构建以 exit code 100 失败。
RUN if [ -n "$APT_MIRROR" ]; then \
      for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
        if [ -f "$f" ]; then sed -i "s|deb.debian.org|$APT_MIRROR|g" "$f"; fi; \
      done; \
      unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY; \
    fi \
  && apt-get -o Acquire::Retries=5 update \
  && apt-get -o Acquire::Retries=5 install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# 同理，NPM_REGISTRY 可指向 npmmirror；填了就让它直连，npm ci 的下载量比 apt 还大
ARG NPM_REGISTRY
RUN if [ -n "$NPM_REGISTRY" ]; then \
      npm config set registry "$NPM_REGISTRY"; \
      host=$(echo "$NPM_REGISTRY" | sed -E 's|^https?://||; s|/.*$||'); \
      export no_proxy="$no_proxy,$host" NO_PROXY="$NO_PROXY,$host"; \
    fi \
  && npm ci

# ---- 生产依赖裁剪 ----
# 就地在 deps 的完整安装上裁掉 devDependencies：复用同一批层，
# 既不重新联网，也不会重新编译 better-sqlite3 的原生模块。
FROM deps AS prod-deps
RUN npm prune --omit=dev

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
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=5533
ENV HOSTNAME=0.0.0.0

# 生产依赖直接取自 prod-deps：不重装、不重编译，也不再需要 python3/make/g++
# 那套编译工具链（better-sqlite3 的原生模块在 deps 阶段已编译好）。
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./

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

EXPOSE 5533
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npm", "run", "start"]
