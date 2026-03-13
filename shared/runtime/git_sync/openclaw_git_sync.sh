#!/bin/zsh
set -euo pipefail

export GIT_TERMINAL_PROMPT=0

OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/.openclaw}"
TARGET_REMOTE="${OPENCLAW_GIT_REMOTE:-origin}"
TARGET_BRANCH="${OPENCLAW_GIT_BRANCH:-main}"
MODE="major-docs"
DRY_RUN=0
FORCE=0

usage() {
  cat <<'EOF'
Usage:
  openclaw_git_sync.sh [--daily] [--force] [--dry-run]

Modes:
  --daily    Sync any pending change as the daily snapshot run.
  --force    Sync regardless of whether a major document changed.
  --dry-run  Print decision details without committing or pushing.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --daily)
      MODE="daily"
      ;;
    --force)
      FORCE=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

cd "$OPENCLAW_ROOT"

origin_url="$(git remote get-url "$TARGET_REMOTE" 2>/dev/null || true)"
if [ -z "$origin_url" ]; then
  echo "Missing git remote: ${TARGET_REMOTE}" >&2
  exit 1
fi

if ! printf '%s\n' "$origin_url" | rg -q 'github\.com[:/]Junkfooooood/openclaw-base(\.git)?$'; then
  echo "Refusing to sync: ${TARGET_REMOTE} is not GitHub openclaw-base." >&2
  echo "Remote URL: ${origin_url}" >&2
  exit 1
fi

collect_changed_files() {
  {
    git diff --name-only
    git diff --cached --name-only
    git ls-files --others --exclude-standard
  } | awk 'NF' | sort -u
}

changed_files="$(collect_changed_files)"

if [ -z "$changed_files" ]; then
  echo "No changes to sync."
  exit 0
fi

major_doc_regex='^(README_QUICKSTART\.md|PROJECT_STRUCTURE\.md|workspace-(main|learning|executor|validator|curator)/[^/]+\.md|shared/policies/.*\.md|shared/sop/(active|archive)/.*\.md)$'

major_changed=0
if printf '%s\n' "$changed_files" | rg -q "$major_doc_regex"; then
  major_changed=1
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "mode=$MODE"
  echo "force=$FORCE"
  echo "major_changed=$major_changed"
  printf '%s\n' "$changed_files"
  exit 0
fi

if [ "$MODE" != "daily" ] && [ "$FORCE" -ne 1 ] && [ "$major_changed" -ne 1 ]; then
  echo "Skip sync: no major document changes detected."
  exit 0
fi

git add -A

if git diff --cached --quiet; then
  echo "Nothing staged after refresh."
  exit 0
fi

timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
label="major-doc"
if [ "$MODE" = "daily" ]; then
  label="daily"
fi

git commit -m "openclaw ${label} sync: ${timestamp}"

branch="$(git branch --show-current)"
if [ -z "$branch" ]; then
  echo "Unable to determine current branch." >&2
  exit 1
fi

if [ "$branch" != "$TARGET_BRANCH" ]; then
  echo "Refusing to sync: current branch is ${branch}, expected ${TARGET_BRANCH}." >&2
  exit 1
fi

push_args=("push" "$TARGET_REMOTE" "$TARGET_BRANCH")
if ! git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  push_args=("push" "-u" "$TARGET_REMOTE" "$TARGET_BRANCH")
fi

attempt=1
while [ "$attempt" -le 5 ]; do
  if git "${push_args[@]}"; then
    echo "Synced ${TARGET_REMOTE}/${TARGET_BRANCH} (${label})."
    exit 0
  fi
  sleep $((attempt * 15))
  attempt=$((attempt + 1))
done

echo "Git push failed after 5 attempts." >&2
exit 1
