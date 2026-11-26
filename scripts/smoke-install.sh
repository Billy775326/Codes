#!/usr/bin/env bash
set -euo pipefail

export TEST_RELEASE_ASSETS
TEST_RELEASE_ASSETS=$(realpath "${1:?Specify a release asset directory}")
stage=$(mktemp -d)
original_path=$PATH
export HOME=$stage/home XDG_DATA_HOME=$stage/data
export CODES_APP_DIR="$stage/installed app" CODES_BIN_DIR="$stage/installed bin"
export CODES_RUNTIME=mock CODES_PORT=19180 CODES_HOST=127.0.0.1
export CODES_DATA_DIR=$stage/workspace
trap 'if [[ -e $CODES_DATA_DIR/server.lock ]]; then "$CODES_BIN_DIR/codes" stop; fi; rm -rf -- "$stage"' EXIT
mkdir -p "$HOME" "$stage/downloads"
cat >"$stage/downloads/curl" <<'EOF'
#!/usr/bin/env bash
set -eu
destination=
while (( $# )); do
  if [[ $1 = --output ]]; then destination=$2; shift; fi
  if [[ $1 = https://github.com/Billy775326/Codes/releases/download/* ]]; then
    cp -- "$TEST_RELEASE_ASSETS/${1##*/}" "${destination:?}"
    exit
  fi
  shift
done
exit 1
EOF
chmod +x "$stage/downloads/curl"
PATH="$stage/downloads:$original_path" bash scripts/install.sh
codes=$CODES_BIN_DIR/codes
version=$(node -p 'require("./package.json").version')
[[ $("$codes" --version) == "v$version" ]]
"$codes" start
"$codes" status
curl --fail --silent --show-error http://127.0.0.1:19180/ >"$stage/index.html"
grep -q '<title>Codes</title>' "$stage/index.html"
PATH="$stage/downloads:$original_path" bash scripts/install.sh
"$codes" status
"$codes" stop
[[ -s $CODES_DATA_DIR/codes.sqlite && -s $CODES_DATA_DIR/access-token ]]

# Exercise a version switch against an existing workspace and a running prior slot.
current=$CODES_APP_DIR/releases/v$version
previous=$CODES_APP_DIR/releases/smoke-prior
cp -al "$current" "$previous"
ln -sfn releases/smoke-prior "$CODES_APP_DIR/current"
"$codes" start
if PATH="$stage/downloads:$original_path" bash scripts/install.sh; then
  echo 'The installer switched versions while Codes was running.' >&2
  exit 1
fi
"$codes" stop
before=$(sha256sum "$CODES_DATA_DIR/codes.sqlite" "$CODES_DATA_DIR/access-token")
PATH="$stage/downloads:$original_path" bash scripts/install.sh
[[ $(readlink "$CODES_APP_DIR/current") == "releases/v$version" && -d $previous ]]
[[ $(sha256sum "$CODES_DATA_DIR/codes.sqlite" "$CODES_DATA_DIR/access-token") == "$before" ]]
