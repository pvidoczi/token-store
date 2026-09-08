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

# Do not push generated CSS directly to protected branches.
# Generated CSS should reach protected branches through merge requests.
if [[ "${CI_COMMIT_REF_PROTECTED:-false}" == "true" ]]; then
  echo "Branch '$target_branch' is protected."
  echo "Skipping generated CSS commit and push."
  exit 0
fi

# Refresh the current state of the remote branch.
git fetch origin "$target_branch"

remote_sha="$(git rev-parse "origin/$target_branch")"
pipeline_sha="${CI_COMMIT_SHA:?CI_COMMIT_SHA must be set}"

# If the branch has changed since this pipeline started,
# the generated CSS may already be outdated.
# In that case, skip this commit and let the newer pipeline handle it.
if [[ "$remote_sha" != "$pipeline_sha" ]]; then
  echo "Branch '$target_branch' has moved since this pipeline started."
  echo "Pipeline commit: $pipeline_sha"
  echo "Current remote:  $remote_sha"
  echo "Skipping generated CSS commit. A newer pipeline should handle it."
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
