#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.local"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

ensure_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    return 0
  fi

  local mysql_password admin_key root_password
  mysql_password="$(openssl rand -hex 16)"
  admin_key="$(openssl rand -hex 24)"
  root_password="$(openssl rand -hex 16)"

  cp "$ENV_EXAMPLE" "$ENV_FILE"
  perl -0pi -e "s/change_me_root_password/$root_password/g; s/change_me_mysql_password/$mysql_password/g; s/change_me_admin_key/$admin_key/g" "$ENV_FILE"
  echo "Created $ENV_FILE"
}

load_env_file() {
  ensure_env_file
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

compose_cmd() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}
