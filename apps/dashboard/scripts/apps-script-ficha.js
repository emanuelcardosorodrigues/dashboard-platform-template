/**
 * Google Apps Script — Ficha de Matrícula → Supabase
 *
 * Instalar:
 * 1. Abra o Google Sheets da ficha de matrícula
 * 2. Extensions → Apps Script
 * 3. Cole todo esse código
 * 4. Salve (Ctrl+S)
 * 5. Vá em Triggers (ícone de relógio) → Add Trigger:
 *    - Function: onFormSubmit
 *    - Event source: From spreadsheet
 *    - Event type: On form submit
 * 6. Autorize quando solicitado
 *
 * Para importar histórico de uma vez:
 *    Execute a função importHistorico() manualmente
 */

// O dashboard recebe via webhook autenticado (o RLS bloqueia a anon key).
// Pegue o secret com o admin e cole abaixo (Project Settings → env FICHA_WEBHOOK_SECRET).
var WEBHOOK_URL = 'https://dashboard.example.com/api/webhook/ficha'
var FICHA_WEBHOOK_SECRET = 'COLE_O_SECRET_AQUI'

// Mapeamento: índice da coluna → campo no Supabase
// Baseado na estrutura real da planilha (71 colunas)
function rowToRecord(values) {
  var email = clean(values[29])  // "Digite abaixo o e-mail cadastrado"
  if (!email || !email.includes('@')) return null

  return {
    email:                email.toLowerCase(),
    nome:                 clean(values[1]),
    whatsapp:             normalizePhone(values[2]),
    sexo:                 clean(values[3]),
    faixa_etaria:         clean(values[4]),
    estado_civil:         clean(values[5]),
    tem_filhos:           clean(values[6]),
    tipo_clinica:         clean(values[7]),   // "Você é..."
    faturamento_declarado: clean(values[9]),  // "Quanto seu consultório fatura"
    num_cadeiras:         clean(values[10]),
    tempo_odontologia:    clean(values[11]),
    especialidade:        clean(values[12]),
    como_conheceu:        clean(values[16]),
    maior_dificuldade:    clean(values[19]),
    medos:                clean(values[20]),
    objetivos:            clean(values[21]),
    o_que_falta:          clean(values[22]),
    unica_coisa_incomoda: clean(values[23]),
    motivo_compra:        clean(values[24]),
    o_que_impediu:        clean(values[25]),
    instagram:            clean(values[34]),
    tentou_antes:         clean(values[35]),
    funcionou:            clean(values[36]),
    por_que_nao_funcionou: clean(values[37]),
    emocao_fim_mes:       clean(values[38]),
    valor_sonho_mensal:   clean(values[39]),  // "Quanto sobraria para dizer que funcionou"
    quanto_sobra:         clean(values[42]),  // "Quanto sobra hoje"
    tem_socio:            clean(values[43]),
    cpf_cnpj:             clean(values[45]),  // CPF ou CNPJ
    tem_ficha:            true,
  }
}

function normalizePhone(val) {
  if (!val) return ''
  var digits = String(val).replace(/\D/g, '')
  if (!digits) return ''
  // Remove DDI 55 se vier com 13+ dígitos
  if (digits.startsWith('55') && digits.length >= 12) digits = digits.slice(2)
  // 10 dígitos (sem o 9): adiciona o 9
  if (digits.length === 10) digits = digits.slice(0, 2) + '9' + digits.slice(2)
  if (digits.length !== 11) return String(val).trim() // mantém original se não reconhecer
  return '+55' + digits
}

function clean(val) {
  if (val === null || val === undefined) return ''
  return String(val).trim()
}

function upsertToSupabase(record) {
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

// Trigger: roda automaticamente quando o formulário é enviado
function onFormSubmit(e) {
  try {
    var values = e.values  // array com os valores da linha
    var record = rowToRecord(values)
    if (!record) {
      Logger.log('Linha ignorada: sem e-mail')
      return
    }
    var code = upsertToSupabase(record)
    Logger.log('Inserido: ' + record.email + ' (HTTP ' + code + ')')
  } catch (err) {
    Logger.log('Erro onFormSubmit: ' + err.message)
  }
}

// Importação histórica manual — rode uma vez para carregar dados existentes
function importHistorico() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet()
  var data = sheet.getDataRange().getValues()

  Logger.log('Total de linhas: ' + (data.length - 1))
  var ok = 0, erros = 0

  for (var i = 1; i < data.length; i++) {
    var record = rowToRecord(data[i])
    if (!record) continue

    var code = upsertToSupabase(record)
    if (code === 200 || code === 201) {
      ok++
    } else {
      erros++
      Logger.log('Erro linha ' + (i + 1) + ': ' + record.email)
    }

    // Pausa a cada 50 para não bater no rate limit
    if (i % 50 === 0) {
      Utilities.sleep(1000)
      Logger.log('Progresso: ' + i + '/' + (data.length - 1))
    }
  }

  Logger.log('Concluído: ' + ok + ' inseridos, ' + erros + ' erros')
}
