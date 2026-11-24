#!/usr/bin/env bash
# Builds the PreLegal image and (re)starts the container at http://localhost:8000.
# Shared by start-mac.sh and start-linux.sh. Every start gets a fresh temporary database.
set -euo pipefail

IMAGE=prelegal
CONTAINER=prelegal
PORT="${PRELEGAL_PORT:-8000}"  # override if 8000 is taken

cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker and try again." >&2
  exit 1
fi

echo "Building image '$IMAGE'..."
docker build -t "$IMAGE" .

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

# .env (e.g. OPENAI_API_KEY) is passed at run time, never baked into the image.
env_args=()
if [ -f .env ]; then env_args=(--env-file .env); fi

echo "Starting container '$CONTAINER'..."
if ! docker run -d --name "$CONTAINER" -p "$PORT:8000" ${env_args[@]+"${env_args[@]}"} "$IMAGE" >/dev/null; then
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  echo "Could not start the container. Is port $PORT already in use? Set PRELEGAL_PORT to use another port." >&2
  exit 1
fi

for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "PreLegal is running at http://localhost:$PORT"
    exit 0
  fi
  sleep 1
done

echo "PreLegal did not become healthy within 30 seconds. Recent logs:" >&2
docker logs --tail 50 "$CONTAINER" >&2
exit 1
