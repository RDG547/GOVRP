#!/bin/bash
set -euo pipefail

command=${SSH_ORIGINAL_COMMAND:-}
if [[ "$command" == verify ]]; then
  printf 'verify\n' | sudo -n /usr/local/sbin/govrp-whatsapp-deploy
elif [[ "$command" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  printf '%s\n' "${BASH_REMATCH[1]}" | sudo -n /usr/local/sbin/govrp-whatsapp-deploy
else
  printf 'Esta chave aceita apenas verify ou deploy seguido de um commit de main.\n' >&2
  exit 64
fi
