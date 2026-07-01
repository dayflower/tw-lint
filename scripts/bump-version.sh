#!/usr/bin/env bash
#
# Open a release PR that bumps the package version.
#
# Usage:
#   scripts/bump-version.sh <patch|minor|major|X.Y.Z>
#
# This script never commits to or tags main directly. It bumps the version on a
# dedicated `release/vX.Y.Z` branch and opens a PR against main. Merging that PR
# triggers .github/workflows/release.yml, which tests, publishes to npm, and
# creates the git tag + GitHub Release.
set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 1
}

# --- Arguments -------------------------------------------------------------

[ "$#" -eq 1 ] || die "usage: $0 <patch|minor|major|X.Y.Z>"
bump="$1"

# --- Preconditions ---------------------------------------------------------

command -v gh >/dev/null 2>&1 || die "the GitHub CLI (gh) is required."

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || die "must be run on 'main' (currently on '$branch')."

[ -z "$(git status --porcelain)" ] || die "working tree is not clean; commit or stash first."

git fetch origin main
[ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ] \
  || die "local main is not in sync with origin/main; pull/push first."

# --- Bump ------------------------------------------------------------------

# Update package.json / package-lock.json in the working tree without creating a
# commit or tag, then read the resulting version.
npm version "$bump" --no-git-tag-version >/dev/null
version="$(node -p "require('./package.json').version")"
release_branch="release/v$version"

if git rev-parse --verify "$release_branch" >/dev/null 2>&1 \
  || git ls-remote --exit-code --heads origin "$release_branch" >/dev/null 2>&1; then
  git checkout -- package.json package-lock.json
  die "branch '$release_branch' already exists; is v$version already in flight?"
fi

# Carry the bump onto the release branch and commit it there (main stays clean).
git checkout -b "$release_branch"
git add package.json package-lock.json
git commit -m "chore: release v$version"
git push -u origin "$release_branch"

gh pr create \
  --base main \
  --head "$release_branch" \
  --title "chore: release v$version" \
  --body "Release v$version. Merging this PR publishes to npm and creates the tag/release via CI."

# Leave the user back on a clean main.
git checkout main

echo "Opened release PR for v$version. Merge it to publish."
