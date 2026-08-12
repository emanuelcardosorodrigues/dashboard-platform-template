// Testes do integrador WebIss com fetch mockado.
//
// Estes testes importam diretamente `src/webiss.js` e mockam globalThis.fetch
// pra validar o parsing e o handling de erro/timeout sem ir até a rede.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enviarNfse, cancelarNfse } from '../src/webiss.js'

const CABECALHO = `<CabecalhoSimples/>`
const DADOS_XML = `<DadosSimples/>`

const SOAP_OK = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <RecepcionarLoteRpsSincronoResponse xmlns="http://nfse.abrasf.org.br">
      <outputXML>&lt;CompNfse&gt;&lt;Nfse&gt;&lt;InfNfse&gt;&lt;Numero&gt;2026000000099&lt;/Numero&gt;&lt;CodigoVerificacao&gt;ZX9TQK&lt;/CodigoVerificacao&gt;&lt;/InfNfse&gt;&lt;/Nfse&gt;&lt;/CompNfse&gt;</outputXML>
    </RecepcionarLoteRpsSincronoResponse>
  </soap:Body>
</soap:Envelope>`

const SOAP_ERRO = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <RecepcionarLoteRpsSincronoResponse xmlns="http://nfse.abrasf.org.br">
      <outputXML>&lt;ListaMensagemRetorno&gt;&lt;MensagemRetorno&gt;&lt;Codigo&gt;E195&lt;/Codigo&gt;&lt;Mensagem&gt;Inscri&#231;&#227;o municipal n&#227;o encontrada&lt;/Mensagem&gt;&lt;Correcao&gt;Verificar IM&lt;/Correcao&gt;&lt;/MensagemRetorno&gt;&lt;/ListaMensagemRetorno&gt;</outputXML>
    </RecepcionarLoteRpsSincronoResponse>
  </soap:Body>
</soap:Envelope>`

const SOAP_CANCEL_OK = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <CancelarNfseResponse xmlns="http://nfse.abrasf.org.br">
      <DataHoraCancelamento>2026-05-13T12:00:00</DataHoraCancelamento>
    </CancelarNfseResponse>
  </soap:Body>
</soap:Envelope>`

describe('webiss - enviarNfse (mock fetch)', () => {
  let originalFetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('sucesso WebIss → retorna numero, codigoVerificacao e xmlCompleto', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(SOAP_OK, { status: 200, headers: { 'Content-Type': 'text/xml' } }),
    )

    const result = await enviarNfse(CABECALHO, DADOS_XML, false)
    expect(result.numero).toBe('2026000000099')
    expect(result.codigoVerificacao).toBe('ZX9TQK')
    expect(result.xmlCompleto).toContain('<Numero>2026000000099</Numero>')
  })

  it('endpoint correto por ambiente (produção vs homologação)', async () => {
    const calls = []
    globalThis.fetch = vi.fn(async (url, opts) => {
      calls.push(url)
      return new Response(SOAP_OK, { status: 200 })
    })

    await enviarNfse(CABECALHO, DADOS_XML, false)
    expect(calls[0]).toContain('nfse-homologacao.example.com')

    await enviarNfse(CABECALHO, DADOS_XML, true)
    expect(calls[1]).toContain('nfse.example.com')
  })

  it('erro SOAP da WebIss (sem NumeroNfse + Mensagem presente) → lança Error', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(SOAP_ERRO, { status: 200 }),
    )

    await expect(enviarNfse(CABECALHO, DADOS_XML, false)).rejects.toThrow(
      /WebISS erro/,
    )
  })

  it('HTTP 500 da WebIss → lança Error com status e body', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('Internal Server Error', { status: 500 }),
    )

    await expect(enviarNfse(CABECALHO, DADOS_XML, false)).rejects.toThrow(
      /WebISS HTTP 500/,
    )
  })

  it.skip('timeout WebIss (fetch pendura) → lança erro de timeout — depende de fake timers do isolate', async () => {
    // SKIP: o módulo usa AbortController + setTimeout interno (60s). Pra testar
    // sem esperar 60s reais, precisaríamos de vi.useFakeTimers compatível com
    // o miniflare isolate — não funciona out-of-the-box. Cobertura via integração.
  })
})

describe('webiss - cancelarNfse (mock fetch)', () => {
  let originalFetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('sucesso de cancelamento → retorna ok=true e xmlCompleto', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(SOAP_CANCEL_OK, { status: 200 }),
    )

    const result = await cancelarNfse(CABECALHO, DADOS_XML, false)
    expect(result.ok).toBe(true)
    expect(result.xmlCompleto).toContain('DataHoraCancelamento')
  })

  it('cancelamento com Mensagem de erro → lança Error', async () => {
    const errBody = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body><Resp><Mensagem>NFSe inexistente</Mensagem></Resp></soap:Body>
    </soap:Envelope>`
    globalThis.fetch = vi.fn(async () => new Response(errBody, { status: 200 }))

    await expect(cancelarNfse(CABECALHO, DADOS_XML, false)).rejects.toThrow(
      /NFSe inexistente/,
    )
  })
})
