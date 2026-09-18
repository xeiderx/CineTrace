#!/bin/sh
# 容器启动入口：先确保数据库结构是最新的，再交给 CMD 拉起进程。
# web 与 worker 会同时启动，两者都执行迁移——迁移本身幂等，
# 但并发写入会让 SQLite 短暂上锁，故加重试兜底。
set -e

# 兜底建好数据目录。db/index.ts 里也有 mkdirSync，但绑定挂载到宿主机目录时
# 先建出来能给出更明确的报错位置，也避免挂载点权限异常时误导排查方向。
mkdir -p "$(dirname "${DATABASE_PATH:-/data/cinetrace.db}")" "${ARCHIVE_DIR:-/data/archive}"

migrate() {
  i=1
  while [ "$i" -le 5 ]; do
    if npm run db:migrate; then
      return 0
    fi
    echo "[entrypoint] 迁移第 $i 次失败，5 秒后重试"
    i=$((i + 1))
    sleep 5
  done
  echo "[entrypoint] 迁移连续失败，退出"
  return 1
}

echo "[entrypoint] 应用数据库迁移"
migrate

# 补基础数据（平台、设置、管理员账号），已存在则跳过。
# 数据库为空时会自动生成初始账号，明文密码由 db:seed 直接打印在下面的日志里。
echo "[entrypoint] 初始化基础数据（首次部署会在此输出初始账号与密码）"
npm run db:seed

echo "[entrypoint] 启动：$*"
exec "$@"
