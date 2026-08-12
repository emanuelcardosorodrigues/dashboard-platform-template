/**
 * Google Apps Script — Programa de Aceleração → Supabase
 *
 * O que este script faz:
 * - roda quando uma nova resposta entra na planilha
 * - localiza o email do aluno pela linha enviada
 * - marca `aluno_mentoria = true` na tabela `qualificacao`
 * - atualiza também `nome` e `whatsapp` quando esses campos existirem na planilha
 *
 * Como instalar:
 * 1. Abra a planilha do Programa de Aceleração
 * 2. Extensões → Apps Script
 * 3. Apague qualquer código de exemplo e cole este arquivo inteiro
 * 4. Salve
 * 5. No menu lateral, abra "Triggers" (ícone de relógio)
 * 6. Add Trigger:
 *    - Function: onFormSubmit
 *    - Event source: From spreadsheet
 *    - Event type: On form submit
 * 7. Autorize
 *
 * Para importar histórico:
 * - execute a função `importHistoricoProgramaAceleracao()`
 */

// O dashboard recebe via webhook autenticado (o RLS bloqueia a anon key).
// Pegue o secret com o admin e cole abaixo (mesmo da ficha: FICHA_WEBHOOK_SECRET).
var WEBHOOK_URL = 'https://dashboard.example.com/api/webhook/ficha'
var FICHA_WEBHOOK_SECRET = 'COLE_O_SECRET_AQUI'

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function clean(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function normalizePhone(val) {
  if (!val) return ''
  var digits = String(val).replace(/\D/g, '')
  if (!digits) return ''
  if (digits.substring(0, 2) === '55' && digits.length >= 12) digits = digits.slice(2)
  if (digits.length === 10) digits = digits.slice(0, 2) + '9' + digits.slice(2)
  if (digits.length !== 11) return String(val).trim()
  return '+55' + digits
}

function findColumnIndex(headers, aliases) {
  var normalizedHeaders = headers.map(normalizeHeader)
  // 1ª passada: match exato com os aliases
  for (var i = 0; i < aliases.length; i++) {
    var alias = normalizeHeader(aliases[i])
    var index = normalizedHeaders.indexOf(alias)
    if (index >= 0) return index
  }
  // 2ª passada: cabeçalho que CONTÉM o alias (pega "Endereço de e-mail",
  // "E-mail do aluno", "Qual o seu melhor email?" etc.)
  for (var j = 0; j < aliases.length; j++) {
    var alias2 = normalizeHeader(aliases[j])
    for (var k = 0; k < normalizedHeaders.length; k++) {
      if (normalizedHeaders[k].indexOf(alias2) >= 0) return k
    }
  }
  return -1
}

// DIAGNÓSTICO: rode esta função e olhe o log — mostra os cabeçalhos da planilha
// e qual coluna o script identificou como e-mail.
function debugHeaders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet()
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
  Logger.log('Aba ativa: ' + sheet.getName())
  Logger.log('Cabeçalhos: ' + JSON.stringify(headers))
  var emailIndex = findColumnIndex(headers, ['email', 'e-mail', 'e mail'])
  Logger.log('Coluna de e-mail identificada: ' + (emailIndex >= 0 ? (emailIndex + 1) + ' ("' + headers[emailIndex] + '")' : 'NENHUMA — me mande os cabeçalhos acima'))
  Logger.log('Total de linhas de dados: ' + (sheet.getLastRow() - 1))
}

function rowToProgramaRecord(headers, values) {
  var emailIndex = findColumnIndex(headers, ['email', 'e-mail', 'e mail'])
  if (emailIndex < 0) return null

  var email = clean(values[emailIndex]).toLowerCase()
  if (!email || email.indexOf('@') === -1) return null

  var nomeIndex = findColumnIndex(headers, [
    'nome',
    'nome completo',
    'qual o seu nome',
  ])
  var whatsappIndex = findColumnIndex(headers, [
    'whatsapp',
    'telefone',
    'celular',
    'numero de whatsapp',
  ])

  var record = {
    email: email,
    aluno_mentoria: true,
  }

  if (nomeIndex >= 0) record.nome = clean(values[nomeIndex])
  if (whatsappIndex >= 0) record.whatsapp = normalizePhone(values[whatsappIndex])

  return record
}

function upsertProgramaRecord(record) {
  var response = UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'x-ficha-secret': FICHA_WEBHOOK_SECRET,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify(record),
    muteHttpExceptions: true,
  })

  var code = response.getResponseCode()
  if (code !== 200 && code !== 201) {
    Logger.log('Erro webhook (' + code + '): ' + response.getContentText())
  }
  return code
}

function onFormSubmit(e) {
  try {
    var sheet = e.range.getSheet()
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    var record = rowToProgramaRecord(headers, e.values)

    if (!record) {
      Logger.log('Linha ignorada: email não encontrado')
      return
    }

    var code = upsertProgramaRecord(record)
    Logger.log('Programa de Aceleração atualizado: ' + record.email + ' (HTTP ' + code + ')')
  } catch (err) {
    Logger.log('Erro onFormSubmit: ' + err.message)
  }
}

function importHistoricoProgramaAceleracao() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet()
  var data = sheet.getDataRange().getValues()
  if (!data || data.length < 2) return

  var headers = data[0]
  var ok = 0
  var erros = 0

  for (var i = 1; i < data.length; i++) {
    var record = rowToProgramaRecord(headers, data[i])
    if (!record) continue

    var code = upsertProgramaRecord(record)
    if (code === 200 || code === 201) ok++
    else erros++

    if (i % 50 === 0) {
      Utilities.sleep(1000)
      Logger.log('Progresso: ' + i + '/' + (data.length - 1))
    }
  }

  Logger.log('Concluído: ' + ok + ' registros atualizados, ' + erros + ' erros')
}
