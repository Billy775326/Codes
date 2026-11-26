#!/usr/bin/env bash
set -euo pipefail

output=$(realpath -m "${1:?Specify an output directory}")
version=$(node -p 'require("./package.json").version')
case "$(uname -s):$(node -p 'process.arch')" in
  Linux:x64) platform=linux-x64 ;;
  Linux:arm64) platform=linux-arm64 ;;
  *) printf 'Codes releases require a Linux x64 or ARM64 Node.js build.\n' >&2; exit 1 ;;
esac
if [[ -n ${GITHUB_REF_NAME:-} && $GITHUB_REF_NAME != "v$version" ]]; then
  printf 'The release tag and package version must match.\n' >&2
  exit 1
fi

stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
mkdir "$stage/runtime"
cp -- "$(node -p 'process.execPath')" "$stage/runtime/node"
cp -- "$(node -p 'require("node:path").resolve(process.execPath,"../../LICENSE")')" "$stage/runtime/LICENSE"
cp -R -- dist bin LICENSES package.json package-lock.json README.md CHANGELOG.md "$stage/"
(cd "$stage" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
mkdir -p "$output"
archive=codes-v$version-$platform.tar.gz
tar -czf "$output/$archive" -C "$stage" .
sha256sum "$output/$archive" | cut -d ' ' -f 1 >"$output/$archive.sha256"
