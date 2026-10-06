#!/usr/bin/env bash
#
# Usage: scripts/release.sh
#
# Tags the current commit with `version` from package.json and pushes the tag.
# jsDelivr serves only tagged versions of a public repo, so every release
# that should reach the CDN needs one. Run by `npm run release`.

set -eu

cd "$(dirname "$0")/.."

version=$(node -p 'require("./package.json").version')
branch=$(git rev-parse --abbrev-ref HEAD)

[ -z "$(git status --porcelain)" ] || { echo "dirty tree — commit or stash first" >&2; exit 1; }
[ "$branch" = "main" ] || { echo "on '$branch' — release from main" >&2; exit 1; }

git fetch --quiet origin "$branch"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$branch")" ] || { echo "main differs from origin/main — push first" >&2; exit 1; }

git rev-parse -q --verify "refs/tags/$version" >/dev/null && { echo "tag $version exists — bump version in package.json" >&2; exit 1; }

git tag -a "$version" -m "$version"
git push origin "$version"

echo "Released $version"
echo "  https://data.jsdelivr.com/v1/packages/gh/arrmatura/arrmatura-books@$version?structure=tree"
echo "  https://cdn.jsdelivr.net/gh/arrmatura/arrmatura-books@$version/"
