#!/bin/bash
# Alerta de falha/reparo. Chamado pelo OnFailure= do unit. $1 = unit que quebrou.
# Exit 3 do reconcile.ts = REPAROU venda (incidente do webhook), não erro de infra.
set -uo pipefail
UNIT="${1:-desconhecido}"
CHAT_ID=664103662
TOKEN=$(cat "${CREDENTIALS_DIRECTORY}/telegram_bot_token" 2>/dev/null)
[ -z "$TOKEN" ] && { echo "sem telegram_bot_token"; exit 1; }

CODIGO=$(systemctl show -p ExecMainStatus --value "$UNIT" 2>/dev/null)
LOG=$(journalctl -u "$UNIT" -n 15 --no-pager -o cat 2>/dev/null | tail -c 700)

if [ "$CODIGO" = "3" ]; then
  TITULO="🟡 *Reconciliação Hotmart* — venda recuperada"
  CORPO="O webhook PERDEU venda(s) e o pull reparou. Investigar por que o push falhou."
else
  TITULO="🔴 *Reconciliação Hotmart* — falhou"
  CORPO="A rede de segurança do webhook está fora do ar."
fi

TEXTO="${TITULO}

${CORPO}

Unit: \`${UNIT}\` (exit ${CODIGO})
Host: $(hostname)
Quando: $(TZ=America/Sao_Paulo date "+%d/%m %H:%M")

\`\`\`
${LOG}
\`\`\`
Dash: https://dashboard.example.com/visao-geral"

curl -s -m 20 -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${CHAT_ID}" \
  --data-urlencode "parse_mode=Markdown" \
  --data-urlencode "text=${TEXTO}" \
  -o /dev/null -w "telegram HTTP %{http_code}\n"
