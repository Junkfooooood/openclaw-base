#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

DAYS="${1:-365}"

load_env_file

response="$(curl -fsS -X POST "http://127.0.0.1:${WECHAT_API_PORT}/admin/GenAuthKey1?key=${ADMIN_KEY}" \
  -H 'Content-Type: application/json' \
  -d "{\"Count\":1,\"Days\":${DAYS},\"Remark\":\"openclaw-wechat\"}")"
echo "$response"

echo
echo "Attempted to extract TOKEN_KEY:"
echo "$response" | node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    const json = JSON.parse(raw);
    const candidates = [
      json?.Data?.Token,
      json?.Data?.token,
      json?.Data?.AuthKey,
      json?.Data?.authKey,
      json?.Data?.key,
      Array.isArray(json?.Data?.authKeys) ? json.Data.authKeys[0] : undefined,
      json?.authKey,
      json?.AuthKey,
      Array.isArray(json?.Data) ? json.Data[0]?.Token : undefined,
      Array.isArray(json?.Data) ? json.Data[0]?.token : undefined,
      Array.isArray(json?.Data) ? json.Data[0]?.AuthKey : undefined,
      Array.isArray(json?.Data) ? json.Data[0]?.authKey : undefined,
      Array.isArray(json?.Data) ? json.Data[0]?.key : undefined,
    ].filter(Boolean);
    if (candidates.length === 0) {
      console.log("TOKEN_KEY not found automatically. Inspect the JSON above.");
      process.exit(0);
    }
    console.log(candidates[0]);
  } catch (error) {
    console.log("TOKEN_KEY not found automatically. Inspect the raw response above.");
  }
});
'
