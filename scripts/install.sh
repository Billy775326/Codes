#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() { printf 'Codes: %s\n' "$*" >&2; exit 1; }

version=v0.2.2
case "$(uname -s):$(uname -m)" in
  Linux:x86_64) platform=linux-x64 ;;
  Linux:aarch64|Linux:arm64) platform=linux-arm64 ;;
  *) fail 'Use a 64-bit glibc-based Linux system (x86-64 or ARM64).' ;;
esac
for command in curl tar sha256sum flock realpath; do
  command -v "$command" >/dev/null || fail "Install $command and run the installer again."
done

data_home=${XDG_DATA_HOME:-$HOME/.local/share}
[[ $data_home = /* ]] || data_home=$HOME/.local/share
workspace=$(realpath -m -- "${CODES_DATA_DIR:-$data_home/codes}")
app=${CODES_APP_DIR:-$data_home/codes-app}
bin=${CODES_BIN_DIR:-$HOME/.local/bin}
[[ $app = /* && $bin = /* ]] || fail 'App and launcher paths must be absolute.'
mkdir -p -- "$app/releases" "$bin"
exec 9>"$app/.install.lock"
flock -n 9 || fail 'Another Codes installation is in progress.'
stage=$(mktemp -d "$app/.install.XXXXXXXX")
wrapper=
trap 'rm -rf -- "$stage"; if [[ -n $wrapper ]]; then rm -f -- "$wrapper"; fi' EXIT

launcher=$bin/codes
{
  printf '#!/usr/bin/env bash\n'
  printf 'exec %q %q "$@"\n' "$app/current/runtime/node" "$app/current/bin/codes.mjs"
} >"$stage/codes"
if [[ -e $launcher || -L $launcher ]]; then
  [[ ! -L $launcher ]] && cmp -s "$stage/codes" "$launcher" ||
    fail "An existing command owns $launcher. Use CODES_BIN_DIR to choose a separate directory."
fi
if [[ -e $app/current && ! -L $app/current ]]; then
  fail "An existing file owns $app/current."
fi
reinstall=0
if [[ -L $app/current ]]; then
  if [[ $(readlink "$app/current") = "releases/$version" ]]; then
    reinstall=1
    [[ ! -e $workspace/server.lock ]] ||
      fail 'Stop Codes using the existing launcher before reinstalling and resetting the workspace token.'
  else
    [[ ! -e $workspace/server.lock ]] ||
      fail 'Stop Codes using the existing launcher before you install the new version.'
  fi
fi

language=${CODES_LANGUAGE:-en}
port=${CODES_PORT:-6670}
interactive=0
fresh=1
for file in codes.sqlite access-token network-settings.json server.lock; do
  if [[ -e $workspace/$file || -L $workspace/$file ]]; then fresh=0; break; fi
done
if (( fresh )) && [[ -t 1 ]] && { exec 8<>/dev/tty; } 2>/dev/null; then
  interactive=1
fi
say() {
  if [[ $language = zh-CN ]]; then printf '%s' "$2"; else printf '%s' "$1"; fi
}
prompt_port() {
  local selected
  while :; do
    printf '%s [%s]: ' "$(say 'Listen port' '监听端口')" "$port" >&8
    IFS= read -r selected <&8 || fail "$(say 'Installation canceled.' '安装已取消。')"
    selected=${selected:-$port}
    if [[ $selected =~ ^[0-9]{1,5}$ ]] && (( 10#$selected >= 1 && 10#$selected <= 65535 )); then
      port=$((10#$selected))
      return
    fi
    printf '%s\n' "$(say 'Enter a port from 1 to 65535.' '请输入 1 到 65535 之间的端口。')" >&8
  done
}
if (( fresh )); then
  if (( interactive )) && [[ -z ${CODES_LANGUAGE:-} ]]; then
    printf 'Codes setup / Codes 安装\n1) English\n2) 简体中文\n' >&8
    while :; do
      printf 'Interface language / 界面语言 [1]: ' >&8
      IFS= read -r selection <&8 || fail 'Installation canceled.'
      case "$selection" in
        ''|1) language=en; break ;;
        2) language=zh-CN; break ;;
        *) printf 'Choose 1 or 2 / 请选择 1 或 2。\n' >&8 ;;
      esac
    done
  fi
  [[ $language = en || $language = zh-CN ]] || fail 'CODES_LANGUAGE must be en or zh-CN.'
  if (( interactive )) && [[ -z ${CODES_PORT:-} ]]; then prompt_port; fi
  [[ $port =~ ^[0-9]{1,5}$ ]] && (( 10#$port >= 1 && 10#$port <= 65535 )) ||
    fail "$(say 'Enter a port from 1 to 65535.' '请输入 1 到 65535 之间的端口。')"
  port=$((10#$port))
fi

release=$app/releases/$version
if [[ ! -e $release ]]; then
  archive=codes-$version-$platform.tar.gz
  url=https://github.com/Billy775326/Codes/releases/download/$version/$archive
  download() {
    curl --proto '=https' --proto-redir '=https' --fail --silent --show-error --location \
      --connect-timeout 15 --max-time 180 --retry 2 --output "$2" "$1"
  }
  download "$url.sha256" "$stage/digest"
  checksum=$(<"$stage/digest")
  [[ $checksum =~ ^[a-f0-9]{64}$ ]] || fail 'The release checksum is invalid.'
  download "$url" "$stage/bundle.tar.gz"
  printf '%s  %s\n' "$checksum" "$stage/bundle.tar.gz" | sha256sum --check --status ||
    fail 'The archive checksum does not match.'
  mkdir "$stage/release"
  tar -xzf "$stage/bundle.tar.gz" -C "$stage/release" --no-same-owner
  [[ $("$stage/release/runtime/node" "$stage/release/bin/codes.mjs" --version) == "$version" ]] ||
    fail 'The release version does not match the installer.'
  mv -T -- "$stage/release" "$release"
fi

[[ $("$release/runtime/node" "$release/bin/codes.mjs" --version) == "$version" ]] ||
  fail 'The installed release is incomplete.'
# Use the bundled runtime and the same configuration and token code as startup.
provision() {
  "$release/runtime/node" --input-type=module - "$release" "$workspace" "$language" "$port" "$fresh" "$reinstall" "$stage" <<'NODE'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [release, directory, language, port, fresh, reinstall, stage] = process.argv.slice(2);
const load = (name) => import(pathToFileURL(join(release, 'dist/server', name + '.js')).href);
const { NetworkConfiguration } = await load('network-settings');
const env = fresh === '1' ? { ...process.env, CODES_PORT: port } : process.env;
const network = new NetworkConfiguration(directory, env);
const { host, port: listenerPort } = network.active;
const localHost = host === '::1' ? '[::1]' : host;
const localUrl = `http://${localHost}:${listenerPort}`;
const browserUrl = network.active.origins.includes(new URL(localUrl).origin) ? localUrl : network.active.origins[0];

function initialOrigins() {
  const origins = network.active.origins;
  if (env.CODES_PUBLIC_ORIGIN !== undefined) return origins;
  let interfaces;
  try {
    interfaces = Object.values(networkInterfaces()).flat();
  } catch (error) {
    if (error.code !== 'ERR_SYSTEM_ERROR' || error.info?.syscall !== 'uv_interface_addresses') throw error;
    console.warn(language === 'zh-CN'
      ? '无法读取本机 IP，使用默认回环地址。'
      : 'Could not read host IPs. Using the default loopback addresses.');
    return origins;
  }
  const hostOrigins = interfaces
    .filter((entry) => entry && !entry.internal && !entry.scopeid)
    .map(({ address, family }) => {
      const hostname = family === 'IPv6' ? `[${address}]` : address;
      return new URL(`http://${hostname}:${listenerPort}`).origin;
    });
  // The network settings schema accepts up to 32 origins, including loopback.
  return [...new Set([...origins, ...hostOrigins])].slice(0, 32);
}

if (fresh === '1') {
  const probe = createServer();
  try {
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(listenerPort, host, resolve);
    });
  } catch (error) {
    if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error;
    process.exit(2);
  } finally {
    if (probe.listening) await new Promise((resolve) => probe.close(resolve));
  }
}

const tokenPath = join(directory, 'access-token');
const languagePath = join(directory, 'installation-settings.json');
const fileToken = process.env.CODES_ACCESS_TOKEN === undefined;
if (fresh === '1' || (fileToken && (reinstall === '1' || !existsSync(tokenPath)))) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const { acquireDataDirectoryLock } = await load('data-directory-lock');
  const unlock = acquireDataDirectoryLock(directory);
  try {
    if (fresh === '1') {
      if (['codes.sqlite', 'access-token', 'network-settings.json'].some((name) => existsSync(join(directory, name))))
        throw new Error('The workspace changed during installation. Run the installer again.');
      const { writeSettingsFile } = await load('settings-file');
      if (!existsSync(languagePath)) writeSettingsFile(languagePath, { version: 1, language });
      writeSettingsFile(join(directory, 'network-settings.json'), {
        version: 1,
        revision: 0,
        settings: { ...network.active, origins: initialOrigins() },
      });
    }
    if (fileToken) {
      const { AccessToken } = await load('access-token');
      const token = new AccessToken(directory);
      if (token.created || reinstall === '1') {
        if (!token.created) token.replace(randomBytes(32).toString('hex'));
        writeFileSync(join(stage, 'token-created'), '', { flag: 'wx' });
      }
    }
  } finally {
    unlock();
  }
}
const { readSettingsFile } = await load('settings-file');
const savedLanguage = readSettingsFile(languagePath)?.language;
if (!process.env.CODES_LANGUAGE && (savedLanguage === 'en' || savedLanguage === 'zh-CN'))
  writeFileSync(join(stage, 'language'), savedLanguage, { flag: 'wx' });
console.log(browserUrl);
NODE
}
while :; do
  if address=$(provision); then break; else status=$?; fi
  (( status == 2 )) || fail "$(say 'Could not initialize the workspace.' '无法初始化工作区。')"
  printf '%s %s\n' "$port" "$(say 'is in use or unavailable on the local listener.' '端口已被占用或当前不可用。')" >&2
  (( interactive )) && [[ -z ${CODES_PORT:-} ]] || fail "$(say 'Set CODES_PORT to an available port and run the installer again.' '请将 CODES_PORT 设置为可用端口后重新安装。')"
  prompt_port
done

if [[ -f $stage/language ]]; then language=$(<"$stage/language"); fi
ln -s "releases/$version" "$stage/current"
mv -Tf -- "$stage/current" "$app/current"
if [[ ! -e $launcher && ! -L $launcher ]]; then
  wrapper=$(mktemp "$bin/.codes.XXXXXXXX")
  install -m 755 "$stage/codes" "$wrapper"
  ln -T -- "$wrapper" "$launcher" || fail "The launcher path is in use: $launcher"
fi

printf '%s %s\n' "$(say 'Installed Codes' '已安装 Codes')" "$version"
if ! command -v codex >/dev/null && [[ -z ${CODES_CODEX_BINARY:-} ]]; then
  printf '%s\n' "$(say 'Install Codex CLI before starting Codes.' '启动 Codes 前，请先安装 Codex CLI。')"
fi
case ":$PATH:" in
  *":$bin:"*) start_command=codes ;;
  *) start_command=$launcher ;;
esac
printf '%s ' "$(say 'Start with:' '启动命令：')"
if [[ -n ${CODES_DATA_DIR:-} ]]; then printf 'CODES_DATA_DIR=%q ' "$workspace"; fi
printf '%q start\n' "$start_command"
printf '%s %s\n' "$(say 'Workspace URL:' '工作区地址：')" "$address"
if [[ -n ${CODES_ACCESS_TOKEN+x} ]]; then
  printf '%s\n' "$(say 'The workspace uses the token from CODES_ACCESS_TOKEN at startup.' '启动时，工作区使用 CODES_ACCESS_TOKEN 提供的令牌。')"
else
  printf '%s %s\n' "$(say 'Token file:' '令牌文件：')" "$workspace/access-token"
  if [[ -f $stage/token-created ]]; then
    printf '%s %s\n' "$(say 'Workspace access token:' '工作区访问令牌：')" "$(<"$workspace/access-token")"
    if (( reinstall )); then printf '%s\n' "$(say 'The previous token has been reset.' '旧令牌已重置。')"; fi
    printf '%s\n' "$(say 'Keep this token private.' '请妥善保管此令牌。')"
  fi
fi
printf '%s\n' "$(say 'After starting Codes, open the workspace URL and enter the token to sign in.' '启动 Codes 后，打开工作区地址并输入令牌登录。')"
