# Reconciliação Hotmart — runbook

Rede de segurança da ingestão de vendas. O webhook (`/api/webhook/hotmart`) é o
caminho normal; isto é o **pull** que repara o que ele perder.

## Por que não roda na Vercel

`developers.hotmart.com` devolve **400 `invalid_parameter`** para requisição
originada da rede da Vercel — com token **válido** e **qualquer** query. Medido
em 22/07/2026 com o mesmo token efêmero nas três origens:

| origem | `max_results=1` | `transaction=` | intervalo de datas |
|---|---|---|---|
| máquina local | 200 | 200 | 200 |
| VPS Hetzner `equipe` | 200 | 200 | 200 |
| **Vercel Function** | **400** | **400** | **400** |

Não é "datacenter" em geral — a VPS também é datacenter e passa. Token inválido
dá **401**, então o 400 não é autenticação. O host de auth
(`api-sec-vlc.hotmart.com`) **funciona** da Vercel; só o de dados recusa — por
isso o sintoma engana (a auth passa e a chamada seguinte falha).

**Consequência conhecida:** o `fetchHotmartTracking` do webhook (enriquecimento
de `sck` via sales/history) **nunca funcionou em produção** — captura o erro e
devolve `null`, então a atribuição sempre veio do `origin.sck` do payload.

## O que roda

| unit | quando | janela |
|---|---|---|
| `hotmart-reconcile.timer` | a cada 2h (:17) | 3 dias |
| `hotmart-reconcile-deep.timer` | diário 05:40 | 30 dias |

Usuário `hotmartrec`, diretório `/opt/hotmart-reconcile`, sandbox systemd
(`ProtectSystem=strict`, `NoNewPrivileges`, `PrivateTmp`).

Credenciais cifradas em repouso via `systemd-creds`, em
`/etc/credstore.encrypted/hotmart-reconcile.*.cred`.

## Códigos de saída

| código | significado | alerta |
|---|---|---|
| 0 | nada a reparar (estado normal) | — |
| 1 | falha (rede, credencial, banco) | 🔴 Telegram |
| **3** | **reparou venda** — o webhook perdeu algo | 🟡 Telegram |

Exit 3 é deliberado: reparo **é incidente do webhook**, não rotina. Reparo
silencioso ninguém revisa — por isso ele sai não-zero e dispara o `OnFailure`.
Ao receber o 🟡, a pergunta não é "a reconciliação funcionou" (funcionou), é
**por que o push falhou**.

## Operação

```bash
# ver estado
systemctl list-timers 'hotmart-reconcile*'
journalctl -u hotmart-reconcile.service -n 50

# rodar à mão (sem gravar)
sudo systemctl start hotmart-reconcile.service          # janela de 3 dias
sudo -u hotmartrec node /opt/hotmart-reconcile/reconcile.ts --days 30 --dry

# publicar mudança (do repo, na máquina de dev)
./scripts/vps-reconcile/deploy.sh equipe
```

`hotmartSync.ts` **não é versionado nesta pasta** — o `deploy.sh` copia de
`lib/hotmartSync.ts` a cada publicação, para não existirem duas cópias
divergindo em silêncio. O mesmo módulo monta a linha no webhook e aqui, então
uma venda reparada é indistinguível da que veio pelo push.

## Verificação feita (22/07/2026)

- Rodada real sob systemd com credenciais cifradas: 62/62, 0 faltando.
- **Alarme testado engatilhado**, não chamando o script direto: drop-in temporário
  forçou falha da unit real → `hotmart-reconcile-alerta@` disparou, `telegram HTTP 200`.
  (`OnFailure` usa `%N`; com `%n` o nome viria `.service.service` e o alerta sumiria calado.)
- **Reparo testado de verdade**: removi a venda `HP4215134922` do banco, rodei a unit,
  e ela voltou byte a byte (data, hora, nome, produto, valor, `sck_slug`, UTMs, status),
  com exit 3 e alerta 🟡.

## Se precisar reconciliar de outro lugar

Existe `scripts/backfill-hotmart-faltantes.ts` no repo, que roda da máquina de
dev pela mesma lib (dry-run por padrão):

```bash
node scripts/backfill-hotmart-faltantes.ts 2026-01-01 2026-07-22          # confere
node scripts/backfill-hotmart-faltantes.ts 2026-01-01 2026-07-22 --apply  # grava
```
