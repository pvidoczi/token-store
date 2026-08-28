#!/usr/bin/env bash
set -euo pipefail

output_dir="${CSS_OUTPUT_DIR:-ids_css}"
target_branch="${CI_COMMIT_BRANCH:?CI_COMMIT_BRANCH must be set to publish generated CSS}"
repository_url="${SELF_REPO_URL:-${CI_REPOSITORY_URL:?CI_REPOSITORY_URL must be set to push generated CSS}}"
commit_message="${SELF_COMMIT_MESSAGE:-chore(tokens): update generated CSS [skip ci]}"

if [[ ! -f "$output_dir/tokens.css" ]]; then
  echo "No generated CSS to commit."
  exit 0
fi

git add -A -- "$output_dir"
if git diff --cached --quiet; then
  echo "The repository already contains the current generated CSS."
  exit 0
fi

git config user.name "${GIT_AUTHOR_NAME:-token-pipeline}"
git config user.email "${GIT_AUTHOR_EMAIL:-token-pipeline@example.invalid}"
git commit -m "$commit_message"
git push "$repository_url" "HEAD:$target_branch"
