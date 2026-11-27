#!/bin/bash
# dsh-compaction-codex 构建：链接类型依赖 -> tsc 编译 src -> lib。
# 依赖源：本机 dsh 安装分发的 node_modules（按候选顺序探测，取第一个含 dsh-compaction-basic 的）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NM=""
for cand in \
  /home/ubuntu/dsh-install-next-next-next/node_modules \
  /home/ubuntu/dsh-install-next-next-next-next-next/node_modules \
  /home/ubuntu/dsh-install-next-next-next/node_modules \
  "$ROOT/node_modules"; do
  if [ -n "$cand" ] && [ -d "$cand/@deepseek-ai/dsh-compaction-basic" ]; then NM="$cand"; break; fi
done
[ -n "$NM" ] || { echo "build: 找不到含 dsh-compaction-basic 的依赖源 NM" >&2; exit 1; }

TSC=""
for cand in "$HOME/tls/node_modules/typescript/bin/tsc" "$ROOT/node_modules/.bin/tsc"; do
  if [ -n "$cand" ] && [ -f "$cand" ]; then TSC="$cand"; break; fi
done
[ -n "$TSC" ] || { echo "build: 找不到可用 tsc" >&2; exit 1; }

link_pkg() {
  local name="$1" target="$2"
  if [ ! -d "$target" ]; then echo "build: 缺依赖目录 $target（跳过）" >&2; return 0; fi
  node -e "
    const fs = require('fs');
    const path = require('path');
    const link = path.resolve(process.argv[1]);
    const target = path.resolve(process.argv[2]);
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, 'dir');
  " "node_modules/$name" "$target"
}

echo "=== 链接类型依赖（源: $NM）==="
mkdir -p node_modules/@deepseek-ai
link_pkg @deepseek-ai/cordis "$NM/@deepseek-ai/cordis"
link_pkg @deepseek-ai/schemastery "$NM/@deepseek-ai/schemastery"
link_pkg @deepseek-ai/dsh-compaction "$NM/@deepseek-ai/dsh-compaction"
link_pkg @deepseek-ai/dsh-compaction-basic "$NM/@deepseek-ai/dsh-compaction-basic"
link_pkg @deepseek-ai/dsh-session "$NM/@deepseek-ai/dsh-session"
link_pkg @deepseek-ai/dsh-agent "$NM/@deepseek-ai/dsh-agent"
link_pkg @deepseek-ai/dsh-commands "$NM/@deepseek-ai/dsh-commands"
link_pkg @deepseek-ai/dsh-llm "$NM/@deepseek-ai/dsh-llm"
link_pkg @types/node "$NM/@types/node"
if [ -d "$NM/@standard-schema/spec" ]; then
  node -e "
    const fs = require('fs');
    const path = require('path');
    fs.rmSync('node_modules/@standard-schema', { recursive: true, force: true });
    fs.mkdirSync('node_modules/@standard-schema', { recursive: true });
    fs.symlinkSync(path.resolve(process.argv[1]), path.resolve('node_modules/@standard-schema/spec'), 'dir');
  " "$NM/@standard-schema/spec"
fi

echo "=== 编译 src -> lib（tsc: $TSC）==="
node "$TSC" -p tsconfig.json
echo "=== Build complete ==="
