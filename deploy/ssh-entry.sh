#!/usr/bin/env bash
set -euo pipefail
# GitHub 专用 SSH 密钥通过 authorized_keys 的 command= 固定调用本文件。
# 禁止任意远程命令，只接收组件与完整提交 SHA，部署包从标准输入读取。
if [[ ${SSH_ORIGINAL_COMMAND:-} =~ ^(backend|frontend)\ ([0-9a-f]{40})$ ]]; then
  exec sudo -n /usr/local/sbin/xiachedan-release "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
fi
echo 'Only backend/frontend release commands are allowed' >&2
exit 64
