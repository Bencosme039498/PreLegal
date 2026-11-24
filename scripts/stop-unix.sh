#!/usr/bin/env bash
# Stops and removes the PreLegal container (its temporary database goes with it).
# Shared by stop-mac.sh and stop-linux.sh.
set -euo pipefail

CONTAINER=prelegal

if docker rm -f "$CONTAINER" >/dev/null 2>&1; then
  echo "PreLegal stopped."
else
  echo "PreLegal is not running."
fi
