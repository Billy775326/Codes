#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() { printf 'Codes: %s\n' "$*" >&2; exit 1; }

version=v0.1.0
case "$(uname -s):$(uname -m)" in
  Linux:x86_64) platform=linux-x64 ;;
  Linux:aarch64|Linux:arm64) platform=linux-arm64 ;;
  *) fail 'Use a 64-bit glibc-based Linux system (x86-64 or ARM64).' ;;
esac
for command in curl tar sha256sum flock; do
  command -v "$command" >/dev/null || fail "Install $command and run the installer again."
done

data_home=${XDG_DATA_HOME:-$HOME/.local/share}
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
if [[ -L $app/current && $(readlink "$app/current") != "releases/$version" ]]; then
  [[ ! -e ${CODES_DATA_DIR:-$data_home/codes}/server.lock ]] ||
    fail 'Stop Codes using the existing launcher before you install the new version.'
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
ln -s "releases/$version" "$stage/current"
mv -Tf -- "$stage/current" "$app/current"
if [[ ! -e $launcher && ! -L $launcher ]]; then
  wrapper=$(mktemp "$bin/.codes.XXXXXXXX")
  install -m 755 "$stage/codes" "$wrapper"
  ln -T -- "$wrapper" "$launcher" || fail "The launcher path is in use: $launcher"
fi

printf 'Installed Codes %s.\n' "$version"
if ! command -v codex >/dev/null && [[ -z ${CODES_CODEX_BINARY:-} ]]; then
  printf 'Install Codex CLI and sign in before starting Codes.\n'
fi
case ":$PATH:" in
  *":$bin:"*) printf 'Start with: codes start\n' ;;
  *) printf 'Start with: %q start\n' "$launcher" ;;
esac
