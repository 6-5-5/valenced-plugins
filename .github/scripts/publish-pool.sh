#!/usr/bin/env bash
# Copies planned artifacts into the pool, regenerates the index, and pushes the changes.
#
# One commit keeps the index a pure function of the pool, so a failed run publishes nothing.

set -euo pipefail
# shellcheck source=.github/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

base="$(pages_base_url)"
echo "Serving the pool from ${base}/pool"

count="$(jq 'length' "$PLAN")"
jq -r '.[] | [.zip, .file] | @tsv' "$PLAN" > plan.tsv

# Missing artifact.
while IFS=$'\t' read -r zip _; do
    [ -f "$zip" ] || { echo "::error::missing artifact ${zip}"; exit 1; }
done < plan.tsv

if [ "$count" -gt 0 ]; then
    mkdir -p build
    # Dereference package links so the archive contains the exact installed bundled sources.
    tar --dereference --exclude='*/build' -czf build/source.tar.gz \
        plugins .github gradle gradlew gradlew.bat build.gradle.kts settings.gradle.kts \
        gradle.properties package.json bun.lock tsconfig.base.json biome.json repo.config.json \
        wrangler.json README.md LICENSE THIRD_PARTY_NOTICES.md \
        node_modules/franc-min node_modules/iso-639-3 node_modules/trigram-utils \
        node_modules/n-gram node_modules/collapse-white-space
fi

attempt_publish() {
    mkdir -p "$POOL_CHECKOUT/pool"
    if [ "$count" -gt 0 ]; then
        mkdir -p "$POOL_CHECKOUT/source" || return 1
        cp "$PLAN" "$POOL_CHECKOUT/releases.json" || return 1
    fi

    while IFS=$'\t' read -r zip file; do
        # Retries reset the checkout, so we need to copy the artifact here.
        cp "$zip" "$POOL_CHECKOUT/pool/${file}" || return 1
        cp build/source.tar.gz "$POOL_CHECKOUT/source/${file%.zip}.tar.gz" || return 1
    done < plan.tsv

    bun run generate-index \
        --dist "$POOL_CHECKOUT/pool" \
        --base-url "${base}/pool" \
        --out "$POOL_CHECKOUT/index.json" || return 1

    git -C "$POOL_CHECKOUT" add pool index.json || return 1
    if [ "$count" -gt 0 ]; then
        git -C "$POOL_CHECKOUT" add source releases.json || return 1
    fi
    commit_pool "Pool already holds this plan." "Publish ${count} plugin release(s)"
}

for attempt in 1 2 3; do
    if attempt_publish; then
        exit 0
    fi

    echo "Publish attempt ${attempt} failed. Syncing with ${POOL_BRANCH}."
    git -C "$POOL_CHECKOUT" fetch origin "$POOL_BRANCH" || break
    git -C "$POOL_CHECKOUT" reset --hard "origin/${POOL_BRANCH}" || break
done

echo "::error::could not publish the pool after 3 attempts"
exit 1
