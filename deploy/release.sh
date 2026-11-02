#!/usr/bin/env bash
set -euo pipefail
umask 027
component=${1:?component required}
revision=${2:?revision required}
[[ $component =~ ^(backend|frontend)$ && $revision =~ ^[0-9a-f]{40}$ ]] || exit 64
base=/opt/xiachedan
mkdir -p "$base/$component/releases" /var/lock
# 前后端可以分别发布；服务器按组件串行切换，避免并发覆盖。
exec 9>"/var/lock/xiachedan-$component.lock"
flock -w 600 9
incoming=$(mktemp -d "$base/$component/releases/.incoming-XXXXXXXX")
trap 'rm -rf "$incoming"' EXIT
cat > "$incoming/bundle.tar.gz"
# 禁止包内绝对路径、父目录跳转、设备和软硬链接。
python3 - "$incoming" <<'PY'
import pathlib, sys, tarfile
root = pathlib.Path(sys.argv[1])
with tarfile.open(root / 'bundle.tar.gz', 'r:gz') as archive:
    for entry in archive.getmembers():
        path = pathlib.PurePosixPath(entry.name)
        if path.is_absolute() or '..' in path.parts or not (entry.isfile() or entry.isdir()):
            raise SystemExit('Invalid release archive')
    archive.extractall(root / 'content')
PY
content="$incoming/content"
destination="$base/$component/releases/$revision"
if [[ $component == frontend ]]; then
  test -s "$content/index.html"
  test -d "$content/assets"
  if [[ ! -d $destination ]]; then
    # 保留上一版哈希资源，发布切换时已打开的页面仍能加载附件之外的静态资源。
    if [[ -d $base/frontend/current/assets ]]; then cp -an "$base/frontend/current/assets/." "$content/assets/"; fi
    mv "$content" "$destination"
    chmod -R a+rX "$destination"
  fi
  ln -sfn "$destination" "$base/frontend/current-next"
  mv -Tf "$base/frontend/current-next" "$base/frontend/current"
  echo "Frontend released: $revision"
else
  test -s "$content/image.tar.gz"
  test -s "$content/compose.yml"
  test -s /etc/xiachedan/backend.env
  test -s /etc/xiachedan/admin-password
  docker load -i "$content/image.tar.gz"
  export BACKEND_IMAGE="xiachedan-backend:$revision" RELEASE_SHA="$revision"
  docker image inspect "$BACKEND_IMAGE" >/dev/null
  docker compose -f "$content/compose.yml" config -q
  previous=$(readlink -f "$base/backend/current" || true)
  previous_revision=${previous##*/}
  mkdir -p /var/lib/xiachedan "$base/backups"
  chown 1000:1000 /var/lib/xiachedan
  if [[ ! -d $destination ]]; then
    mkdir "$destination"
    cp "$content/compose.yml" "$destination/compose.yml"
  fi
  rollback() {
    if [[ -f $previous/compose.yml ]]; then
      BACKEND_IMAGE="xiachedan-backend:$previous_revision" RELEASE_SHA="$previous_revision" docker compose -f "$previous/compose.yml" up -d --wait --wait-timeout 90
    fi
  }
  if docker inspect xiachedan-backend >/dev/null 2>&1; then docker stop -t 25 xiachedan-backend; fi
  if [[ -f /var/lib/xiachedan/chat.sqlite ]]; then
    if ! tar -czf "$base/backups/database-$(date -u +%Y%m%dT%H%M%SZ)-$revision.tar.gz" -C /var/lib/xiachedan --wildcards 'chat.sqlite*'; then rollback; exit 1; fi
  fi
  if ! docker compose -f "$destination/compose.yml" up -d --wait --wait-timeout 90; then rollback; exit 1; fi
  if ! curl --fail --silent --max-time 10 http://127.0.0.1:4318/api/health | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["mode"] == "cloud" and x["ok"] and x["release"] == sys.argv[1]' "$revision"; then rollback; exit 1; fi
  ln -sfn "$destination" "$base/backend/current-next"
  mv -Tf "$base/backend/current-next" "$base/backend/current"
  echo "Backend released: $revision"
fi
