#!/usr/bin/env bash
set -euo pipefail

export TEST_RELEASE_ASSETS
TEST_RELEASE_ASSETS=$(realpath "${1:?Specify a release asset directory}")
stage=$(mktemp -d)
original_path=$PATH
export CODES_APP_DIR="$stage/installed app" CODES_BIN_DIR="$stage/installed bin"
export CODES_RUNTIME=mock CODES_PORT=${CODES_INSTALL_TEST_PORT:-19180} CODES_HOST=127.0.0.1
unset CODES_ACCESS_TOKEN CODES_PUBLIC_ORIGIN
export CODES_DATA_DIR=$stage/workspace
blocker=
cleanup() {
  if [[ -n $blocker ]]; then kill "$blocker" 2>/dev/null || true; wait "$blocker" || true; fi
  if [[ -e $CODES_DATA_DIR/server.lock ]]; then "$CODES_BIN_DIR/codes" stop; fi
  rm -rf -- "$stage"
}
trap cleanup EXIT
mkdir -p "$stage/downloads"
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
cat >"$stage/interfaces.mjs" <<'EOF'
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';

os.networkInterfaces = () => ({
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  eth0: [
    { address: '192.0.2.10', family: 'IPv4', internal: false },
    { address: '2001:db8::10', family: 'IPv6', internal: false, scopeid: 0 },
    { address: 'fe80::10', family: 'IPv6', internal: false, scopeid: 2 },
  ],
});
syncBuiltinESMExports();
EOF
install() {
  PATH="$stage/downloads:$original_path" bash scripts/install.sh
}
port=$CODES_PORT
origin=http://127.0.0.1:$port
node --input-type=module - "$stage/busy-port" <<'NODE' &
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';

const server = createServer();
server.listen(0, '127.0.0.1', () => writeFileSync(process.argv[2], String(server.address().port)));
NODE
blocker=$!
for ((attempt = 0; attempt < 40; attempt++)); do
  [[ ! -s $stage/busy-port ]] || break
  sleep 0.05
done
[[ -s $stage/busy-port ]]
printf '2\n0\n%s\n%s\n' "$(<"$stage/busy-port")" "$port" |
  env -u CODES_LANGUAGE -u CODES_PORT PATH="$stage/downloads:$original_path" \
    NODE_OPTIONS="--import=$stage/interfaces.mjs" \
    script --quiet --return --command 'bash scripts/install.sh' /dev/null >"$stage/first-install"
codes=$CODES_BIN_DIR/codes
version=$(node -p 'require("./package.json").version')
[[ $("$codes" --version) == "v$version" ]]
first_token=$(<"$CODES_DATA_DIR/access-token")
[[ $first_token =~ ^[a-f0-9]{64}$ ]]
[[ $(stat -c '%a' "$CODES_DATA_DIR/access-token") == 600 ]]
grep -Fq '监听端口' "$stage/first-install"
grep -Fq '请输入 1 到 65535' "$stage/first-install"
grep -Fq '端口已被占用' "$stage/first-install"
grep -Fq -- "令牌文件： $CODES_DATA_DIR/access-token" "$stage/first-install"
grep -Fq -- "工作区访问令牌： $first_token" "$stage/first-install"
grep -Fq -- "工作区地址： $origin" "$stage/first-install"
node --input-type=module - "$CODES_DATA_DIR/network-settings.json" "$port" <<'NODE'
import { deepStrictEqual, equal } from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const [path, port] = process.argv.slice(2);
const { settings } = JSON.parse(readFileSync(path, 'utf8'));
equal(settings.host, '127.0.0.1');
deepStrictEqual(settings.origins, [
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  `http://[::1]:${port}`,
  `http://192.0.2.10:${port}`,
  `http://[2001:db8::10]:${port}`,
]);
NODE
network_before=$(sha256sum "$CODES_DATA_DIR/network-settings.json")
env -u CODES_PORT "$codes" start
"$codes" status
curl --fail --silent --show-error "$origin/" >"$stage/index.html"
grep -q '<title>Codes</title>' "$stage/index.html"
grep -q '<html lang="zh-CN">' "$stage/index.html"
curl --fail --silent --show-error --header "Host: 192.0.2.10:$port" "$origin/" >/dev/null
if install >"$stage/running-reinstall" 2>&1; then
  echo 'The installer reset the token while Codes was running.' >&2
  exit 1
fi
[[ $(<"$CODES_DATA_DIR/access-token") == "$first_token" ]]
"$codes" stop

CODES_PORT=1 install >"$stage/reinstall"
[[ $(sha256sum "$CODES_DATA_DIR/network-settings.json") == "$network_before" ]]
new_token=$(<"$CODES_DATA_DIR/access-token")
[[ $new_token =~ ^[a-f0-9]{64}$ && $new_token != "$first_token" ]]
grep -Fq -- "工作区访问令牌： $new_token" "$stage/reinstall"
grep -Fq -- "工作区地址： $origin" "$stage/reinstall"
env -u CODES_PORT "$codes" start
login_status() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --header "Origin: $origin" --header 'Content-Type: application/json' \
    --data-binary @- "$origin/api/login"
}
[[ $(printf '{"token":"%s"}' "$first_token" | login_status) == 401 ]]
[[ $(printf '{"token":"%s"}' "$new_token" | login_status) == 200 ]]
"$codes" stop
[[ -s $CODES_DATA_DIR/codes.sqlite ]]

# Exercise a version switch against an existing workspace and a running prior slot.
current=$CODES_APP_DIR/releases/v$version
previous=$CODES_APP_DIR/releases/smoke-prior
cp -al "$current" "$previous"
ln -sfn releases/smoke-prior "$CODES_APP_DIR/current"
"$codes" start
if install; then
  echo 'The installer switched versions while Codes was running.' >&2
  exit 1
fi
"$codes" stop
before=$(sha256sum "$CODES_DATA_DIR/codes.sqlite" "$CODES_DATA_DIR/access-token")
install >"$stage/upgrade"
if grep -Fq -- "$new_token" "$stage/upgrade"; then exit 1; fi
[[ $(readlink "$CODES_APP_DIR/current") == "releases/v$version" && -d $previous ]]
[[ $(sha256sum "$CODES_DATA_DIR/codes.sqlite" "$CODES_DATA_DIR/access-token") == "$before" ]]
[[ $(sha256sum "$CODES_DATA_DIR/network-settings.json") == "$network_before" ]]

CODES_DATA_DIR="$stage/explicit" CODES_PUBLIC_ORIGIN=https://codes.example.test \
  NODE_OPTIONS="--import=$stage/interfaces.mjs" install >"$stage/explicit-install"
node --input-type=module - "$stage/explicit/network-settings.json" <<'NODE'
import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { settings } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
deepStrictEqual(settings.origins, ['https://codes.example.test']);
NODE
