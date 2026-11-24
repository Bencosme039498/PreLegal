#!/usr/bin/env bash
# Stop PreLegal on macOS. See stop-unix.sh.
exec bash "$(dirname "$0")/stop-unix.sh" "$@"
