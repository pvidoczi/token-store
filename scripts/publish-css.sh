#!/usr/bin/env bash
set -euo pipefail

target_branch="${TARGET_REPO_BRANCH:-IDS_CSS}"
target_css_path="${TARGET_CSS_PATH:-projects/demo/src/assets/ids_css}"
target_checkout="${TARGET_CHECKOUT_DIR:-target-repo}"
commit_message="${TARGET_COMMIT_MESSAGE:-chore(tokens): update generated CSS}"

if [[ "${SKIP_PARSE:-false}" != "true" ]]; then
  npm run parse
fi

if [[ ! -f "${CSS_OUTPUT_DIR:-ids_css}/tokens.css" ]]; then
  echo "No generated CSS to publish. Add Figma JSON files under foundation/ or components/."
  exit 0
fi

: "${TARGET_REPO_URL:?TARGET_REPO_URL must be set to the GitLab clone URL}"

case "$target_checkout" in
  ""|"."|".."|/*|../*|*/../*)
    echo "TARGET_CHECKOUT_DIR must be a safe path below the repository root." >&2
    exit 2
    ;;
esac

case "$target_css_path" in
  ""|"."|".."|/*|../*|*/../*)
    echo "TARGET_CSS_PATH must be a safe relative path inside the target repository." >&2
    exit 2
    ;;
esac

rm -rf -- "$target_checkout"
git clone "$TARGET_REPO_URL" "$target_checkout"

if git -C "$target_checkout" show-ref --verify --quiet "refs/heads/$target_branch"; then
  git -C "$target_checkout" switch "$target_branch"
elif git -C "$target_checkout" show-ref --verify --quiet "refs/remotes/origin/$target_branch"; then
  git -C "$target_checkout" switch --track "origin/$target_branch"
else
  git -C "$target_checkout" switch -c "$target_branch"
fi

destination="$target_checkout/$target_css_path"
mkdir -p "$destination"
find "$destination" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -R "${CSS_OUTPUT_DIR:-ids_css}/." "$destination/"

git -C "$target_checkout" add -- "$target_css_path"
if git -C "$target_checkout" diff --cached --quiet; then
  echo "Target repository already contains the current CSS."
  exit 0
fi

git -C "$target_checkout" config user.name "${GIT_AUTHOR_NAME:-token-pipeline}"
git -C "$target_checkout" config user.email "${GIT_AUTHOR_EMAIL:-token-pipeline@example.invalid}"
git -C "$target_checkout" commit -m "$commit_message"
git -C "$target_checkout" push origin "HEAD:$target_branch"
