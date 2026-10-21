#!/usr/bin/env bash
#
# Usage: ../arrmatura-books/site/release.sh     (npm run release, in a content repo)
#
# Releases the content repo it runs in, then deploys its site:
#
#   1. The repo must be a clean checkout of main that is not behind origin.
#   2. `npm run gen` rewrites www/ for the current version. HEAD already tagged with that
#      version and www/ unchanged → nothing to release. Otherwise, if that version is tagged,
#      bump patch and gen again; a version still untagged is released as is.
#   3. Commit `<version>`, push, tag, push the tag. The tag keeps the repo's style, `1.2.3` or
#      `v1.2.3`, taken from its nearest tag. jsDelivr serves only tags.
#   4. `npm run deploy`.
#
# Stops at the first error. Re-running is safe: a released HEAD is deployed, not released again.

set -eu

name=$(basename "$PWD")
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "❌ $name: not on main" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "❌ $name: dirty tree — commit or stash first" >&2; exit 1; }
git fetch --quiet origin main
git merge-base --is-ancestor origin/main HEAD || { echo "❌ $name: behind origin/main — pull first" >&2; exit 1; }

prefix=$(git describe --tags --abbrev=0 2>/dev/null | grep -o '^v' || true)
version() { node -p 'require("./package.json").version'; }

npm run gen
tag="$prefix$(version)"
released=""
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  if [ "$(git rev-list -n 1 "$tag")" = "$(git rev-parse HEAD)" ] && [ -z "$(git status --porcelain)" ]; then
    released=1
    echo "✅ $name: $tag is current"
  else
    npm version patch --no-git-tag-version >/dev/null
    npm run gen
    tag="$prefix$(version)"
  fi
fi

if [ -z "$released" ]; then
  git add -A
  git commit --quiet -m "$(version)"
  git push --quiet origin main
  git tag -a "$tag" -m "$(version)"
  git push --quiet origin "$tag"
  echo "✅ $name: released $tag"
fi

npm run deploy
