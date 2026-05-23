#!/bin/bash
set -e

cd "$(dirname "$0")"

# ポート7500のプロセスを停止（ss で検出）
PID=$(ss -tlnp | grep ':7500 ' | grep -oP 'pid=\K[0-9]+' || true)
if [ -n "$PID" ]; then
  echo "Stopping process on port 7500 (PID: $PID)..."
  kill "$PID"
  for i in $(seq 1 20); do
    if ! ss -tlnp | grep -q ':7500 '; then
      break
    fi
    sleep 0.5
  done
  # まだ残っていれば強制終了
  PID=$(ss -tlnp | grep ':7500 ' | grep -oP 'pid=\K[0-9]+' || true)
  if [ -n "$PID" ]; then
    echo "Force killing PID: $PID..."
    kill -9 "$PID"
    sleep 1
  fi
fi

echo "Building..."
npm run build

echo "Starting production server..."
npm run start >/dev/null 2>&1 &
