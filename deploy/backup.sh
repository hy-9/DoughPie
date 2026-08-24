#!/usr/bin/env bash
# ==========================================================================
# 豆排排 每日备份脚本（backend.md §9：pg_dump + uploads，保留 14 天）
# 用法：crontab 每日执行，例如
#   0 3 * * * BACKUP_DIR=/backup/豆排排 /opt/doughpie/deploy/backup.sh >> /var/log/doughpie-backup.log 2>&1
# 恢复（H 阶段恢复演练用，步骤注释在文件末尾）
# ==========================================================================
set -euo pipefail

# 备份存放目录（建议外挂磁盘或异地挂载点）
BACKUP_DIR="${BACKUP_DIR:-/backup/豆排排}"
# compose 文件位置（用于定位 db 容器）
COMPOSE_FILE="${COMPOSE_FILE:-/opt/doughpie/deploy/docker-compose.yml}"
KEEP_DAYS=14
TS="$(date +%Y%m%d-%H%M%S)"

mkdir -p "${BACKUP_DIR}"

# 1) 数据库：pg_dump 自定义格式（压缩、可按表恢复）
docker compose -f "${COMPOSE_FILE}" exec -T db \
  pg_dump -U doughpie -Fc 豆排排 > "${BACKUP_DIR}/pg-${TS}.dump"

# 2) 附件：打包 uploads volume（不依赖宿主机 volume 路径，可移植）
docker run --rm \
  -v doughpie_uploads:/data:ro \
  -v "${BACKUP_DIR}:/out" \
  alpine:3 \
  tar -czf "/out/uploads-${TS}.tar.gz" -C /data .

# 3) 清理过期备份
find "${BACKUP_DIR}" -name 'pg-*.dump'      -mtime +${KEEP_DAYS} -delete
find "${BACKUP_DIR}" -name 'uploads-*.tar.gz' -mtime +${KEEP_DAYS} -delete

echo "[$(date -Is)] backup ok: pg-${TS}.dump uploads-${TS}.tar.gz"

# ==========================================================================
# 恢复步骤（恢复演练清单，H 阶段验证）：
#   1) 新机部署 compose（db 先起）：docker compose up -d db
#   2) 恢复数据库：
#        cat pg-YYYY.dump | docker compose -f deploy/docker-compose.yml exec -T db \
#          pg_restore -U doughpie -d doughpie --clean --if-exists
#   3) 恢复附件：
#        docker run --rm -v doughpie_uploads:/data -v /backup/豆排排:/in alpine:3 \
#          sh -c 'tar -xzf /in/uploads-YYYY.tar.gz -C /data'
#   4) 全量启动：docker compose up -d
#   5) 验证：登录 + 看板数据 + 附件可下载 + 通知中心历史可见
# ==========================================================================
