#!/bin/sh
# Container entrypoint: makes the database directory writable, then runs the server as the
# unprivileged "app" user.
#
# The image starts as root only for this step. A persistent disk (Render mounts one at
# /var/data) may be root-owned, and the app must be able to create prelegal.db there.
set -eu

db_dir=$(dirname "${PRELEGAL_DB_PATH:-/tmp/prelegal.db}")

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$db_dir"
  # /tmp (the local default) is already writable; only take ownership of a directory that isn't.
  if ! setpriv --reuid=app --regid=app --init-groups test -w "$db_dir"; then
    chown app:app "$db_dir"
  fi
  exec setpriv --reuid=app --regid=app --init-groups "$@"
fi

exec "$@"
