#!/usr/bin/env bash
# Writes a tag and a GitHub Release per planned version for changelogs.

set -euo pipefail

POOL_CHECKOUT="${POOL_CHECKOUT:-published}"
[ -f "$POOL_CHECKOUT/releases.json" ] || exit 0

# The published ledger lets a rerun repair releases after an interrupted publication.
jq -r '.[] | [.tag, .id, .version, .file, .commit] | @tsv' "$POOL_CHECKOUT/releases.json" |
    while IFS=$'\t' read -r tag id version file commit; do
        if ! git rev-parse -q --verify "refs/tags/${tag}" > /dev/null; then
            git tag "$tag" "$commit"
        elif [ "$(git rev-parse "$tag^{commit}")" != "$commit" ]; then
            echo "::error::tag $tag already points to a different source commit"
            exit 1
        fi
        git push origin "refs/tags/$tag"

        if gh release view "$tag" > /dev/null 2>&1; then
            echo "= ${tag}"
        else
            flags=()
            [[ "$version" != *-* ]] || flags+=(--prerelease)
            gh release create "$tag" \
                --verify-tag \
                --title "$tag" \
                --notes "Automated release of \`${id}\` ${version}." \
                "${flags[@]}"
            echo "+ ${tag}"
        fi
        gh release upload "$tag" "$POOL_CHECKOUT/pool/$file" \
            "$POOL_CHECKOUT/source/${file%.zip}.tar.gz" --clobber
    done
