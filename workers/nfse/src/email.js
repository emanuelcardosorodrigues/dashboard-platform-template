const RESEND_API = 'https://api.resend.com/emails'

function formatarValor(valor) {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarDoc(doc) {
  const d = String(doc ?? '').replace(/\D/g, '')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return doc
}

export async function enviarEmailNota(env, { tipo, nomeTomador, emailTomador, numeroNfse, driveLink, valorServicos, docTomador }) {
  if (!env.RESEND_API_KEY) return { ok: false, status: 'config', body: 'RESEND_API_KEY ausente' }
  if (!env.EMAIL_REMETENTE) return { ok: false, status: 'config', body: 'EMAIL_REMETENTE ausente' }
  if (!emailTomador) return { ok: false, status: 'config', body: 'emailTomador ausente' }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(emailTomador)) return { ok: false, status: 'invalid_email', body: emailTomador }

  const assunto = tipo === 'cancelada'
    ? `Sua NFS-e nº ${numeroNfse} foi cancelada`
    : `Sua NFS-e nº ${numeroNfse} foi emitida`

  const valorHtml = valorServicos
    ? `<p><strong>Valor:</strong> ${formatarValor(valorServicos)}</p>`
    : ''
  const docHtml = docTomador
    ? `<p><strong>Documento:</strong> ${formatarDoc(docTomador)}</p>`
    : ''
  const linkHtml = driveLink
    ? `<p><a href="${driveLink}">Clique aqui para acessar o XML da nota</a></p>`
    : ''

  const html = tipo === 'cancelada'
    ? `<p>Olá, ${nomeTomador}.</p>
       <p>Informamos que a NFS-e nº <strong>${numeroNfse}</strong> foi <strong>cancelada</strong>.</p>
       ${valorHtml}${docHtml}
       <p>Em caso de dúvidas, entre em contato conosco.</p>`
    : `<p>Olá, ${nomeTomador}.</p>
       <p>Sua NFS-e nº <strong>${numeroNfse}</strong> foi emitida com sucesso.</p>
       ${valorHtml}${docHtml}${linkHtml}
       <p>Obrigado!</p>`

  // P1-07: timeout de 15s para Resend
  const ac = new AbortController()
  const t  = setTimeout(() => ac.abort(), 15000)
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    env.EMAIL_REMETENTE,
        to:      [emailTomador],
        subject: assunto,
        html,
      }),
      signal: ac.signal,
    })
    const body = await res.text()
    return { ok: res.ok, status: res.status, body }
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, status: 'timeout', body: 'Resend timeout 15s' }
    return { ok: false, status: 'network_error', body: err.message }
  } finally {
    clearTimeout(t)
  }
}

// Alerta operacional para o admin quando falhas de webhook estouram threshold.
// Reusa o cliente Resend já configurado.
export async function enviarAlertaOps(env, { contagem, ultimaMsg, transactionId }) {
  if (!env.RESEND_API_KEY) return { ok: false, status: 'config', body: 'RESEND_API_KEY ausente' }
  if (!env.EMAIL_REMETENTE) return { ok: false, status: 'config', body: 'EMAIL_REMETENTE ausente' }

  const destino = env.EMAIL_OPS ?? env.EMAIL_REMETENTE
  const assunto = `[NFS-e] ALERTA: ${contagem} falha(s) de webhook na última hora`
  const txPreview = transactionId ? String(transactionId) : '(sem transaction_id)'
  const msgPreview = ultimaMsg ? String(ultimaMsg).slice(0, 500) : '(sem mensagem)'

  const html = `
    <p>Detecção automática de falhas no webhook Hotmart → NFS-e.</p>
    <p><strong>Contagem na última hora:</strong> ${contagem}</p>
    <p><strong>Última mensagem:</strong> ${msgPreview}</p>
    <p><strong>Último transaction_id:</strong> ${txPreview}</p>
    <p>
      Ver logs:
      <a href="https://nf.example.com/admin/webhook-log">/admin/webhook-log</a>
      ou
      <a href="https://nf.example.com/api/webhook-log?resultado=auth_fail_hmac">/api/webhook-log</a>
    </p>
    <p style="color:#888;font-size:.85rem">Throttle: 1 alerta por hora. Próximo só sai se houver novas falhas após a virada do relógio.</p>
  `

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 15000)
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_REMETENTE,
        to: [destino],
        subject: assunto,
        html,
      }),
      signal: ac.signal,
    })
    const body = await res.text()
    return { ok: res.ok, status: res.status, body }
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, status: 'timeout', body: 'Resend timeout 15s' }
    return { ok: false, status: 'network_error', body: err.message }
  } finally {
    clearTimeout(t)
  }
}
