#!/bin/bash
# Run as root from a reviewed checkout or a verified copy of this directory.
set -euo pipefail

test "$(id -u)" = 0
test "$#" = 1
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
account=govrp-deploy
ssh_home=/var/lib/govrp-whatsapp-ssh
state_dir=/var/lib/govrp-whatsapp-deploy
runtime_env=/opt/govrp/services/whatsapp-bot/.env
test "$(stat -c '%u:%a' "$runtime_env")" = 0:600
docker volume inspect whatsapp-bot_govrp_bot_session >/dev/null

IFS= read -r key < "$1"
key=${key%$'\r'}
if [[ ! "$key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ [A-Za-z0-9._@-]+)?$ ]]; then
  printf 'Forneça somente o arquivo público de uma chave ED25519.\n' >&2
  exit 1
fi

if ! id "$account" >/dev/null 2>&1; then
  useradd --system --user-group --no-create-home --home-dir "$ssh_home" --shell /bin/bash "$account"
fi
test "$(id -Gn "$account")" = "$account"
test "$(getent passwd "$account" | cut -d: -f6)" = "$ssh_home"
install -d -m 0750 -o root -g "$account" "$ssh_home" "$ssh_home/.ssh"
install -d -m 0700 -o root -g root "$state_dir"

authorized='restrict,command="/usr/local/sbin/govrp-whatsapp-ssh" '
target="$ssh_home/.ssh/authorized_keys"
if [[ -e "$target" ]] && [[ "$(< "$target")" != "$authorized$key" ]]; then
  printf 'A conta já tem outra chave autorizada.\n' >&2
  exit 1
fi

install -m 0755 -o root -g root "$source_dir/oracle_deploy.py" /usr/local/sbin/govrp-whatsapp-deploy
install -m 0755 -o root -g root "$source_dir/oracle-ssh.sh" /usr/local/sbin/govrp-whatsapp-ssh
install -m 0644 -o root -g root "$source_dir/production.compose.yml" "$state_dir/production.compose.yml"

tmp=$(mktemp)
trap 'rm -f -- "$tmp"' EXIT
printf '%s\n' 'govrp-deploy ALL=(root) NOPASSWD: /usr/local/sbin/govrp-whatsapp-deploy ""' > "$tmp"
visudo -cf "$tmp"
install -m 0440 -o root -g root "$tmp" /etc/sudoers.d/govrp-whatsapp-deploy

printf '%s%s\n' "$authorized" "$key" > "$tmp"
install -m 0640 -o root -g "$account" "$tmp" "$target"
printf 'Entrada SSH restrita instalada para %s.\n' "$account"
