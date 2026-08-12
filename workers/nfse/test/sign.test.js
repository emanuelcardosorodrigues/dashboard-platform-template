// Regression test pra src/sign.js (assinatura ABRASF 2.02).
//
// Estratégia:
//   - Gerar um par RSA-2048 dentro do teste (não usa cert ICP-Brasil real)
//   - Exportar como PEM PKCS#8
//   - Assinar um RPS XML fixo
//   - Validar que a Signature está bem-formada e que ambos Id's (rps1, lote1)
//     foram assinados
//
// Não é regression byte-exact (xml-crypto pode mudar o whitespace de C14N).
// É regression estrutural: garante que o algoritmo SHA-1+RSA continua
// produzindo as 2 Signature blocks esperadas, com SignatureValue base64 válida.

import { describe, it, expect } from 'vitest'
import { signXml } from '../src/sign.js'
import { RPS_XML_FIXTURE } from './helpers/index.js'

// === Helpers de PEM ===
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function toPem(b64, label) {
  const wrapped = b64.match(/.{1,64}/g).join('\n')
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`
}

async function genTestKeyPair() {
  // RSA-SHA1 pra match com o que sign.js usa (ABRASF 2.02 exige SHA-1).
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' },
    true,
    ['sign', 'verify'],
  )
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey)
  return {
    privateKeyPem: toPem(arrayBufferToBase64(pkcs8), 'PRIVATE KEY'),
    // sign.js espera "certificado" mas só lê base64 (não valida X.509) —
    // qualquer base64 serve pro test path. Usamos SPKI bruto.
    publicCertPem: toPem(arrayBufferToBase64(spki), 'CERTIFICATE'),
  }
}

describe('sign - signXml (regression ABRASF 2.02)', () => {
  it('produz duas Signature blocks (rps + lote) com SignatureValue válida', async () => {
    const { privateKeyPem, publicCertPem } = await genTestKeyPair()
    const signed = await signXml(RPS_XML_FIXTURE, privateKeyPem, publicCertPem)

    // 2 blocos Signature: um pra InfDeclaracaoPrestacaoServico (Id=rps1),
    // outro pra LoteRps (Id=lote1).
    const signatureBlocks = signed.match(/<Signature [^>]*>/g) ?? []
    expect(signatureBlocks.length).toBe(2)

    // Referências corretas
    expect(signed).toContain('URI="#rps1"')
    expect(signed).toContain('URI="#lote1"')

    // SignatureValue não vazio em ambos
    const sigValues = [...signed.matchAll(/<SignatureValue>([^<]+)<\/SignatureValue>/g)].map(
      (m) => m[1],
    )
    expect(sigValues.length).toBe(2)
    for (const v of sigValues) {
      expect(v.length).toBeGreaterThan(100) // RSA-2048 → ~344 chars base64
      expect(v).toMatch(/^[A-Za-z0-9+/]+=*$/) // base64 standard
    }

    // X509Certificate presente em ambos
    const certs = [...signed.matchAll(/<X509Certificate>([^<]+)<\/X509Certificate>/g)]
    expect(certs.length).toBe(2)
  })

  it('Signature é inserida DEPOIS do fechamento de cada elemento alvo', async () => {
    const { privateKeyPem, publicCertPem } = await genTestKeyPair()
    const signed = await signXml(RPS_XML_FIXTURE, privateKeyPem, publicCertPem)

    // O regex de inserção em sign.js coloca a Signature logo após </InfDeclaracaoPrestacaoServico>
    // e </LoteRps>.
    expect(signed).toMatch(/<\/InfDeclaracaoPrestacaoServico><Signature /)
    expect(signed).toMatch(/<\/LoteRps><Signature /)
  })

  it('lança erro quando elemento alvo não tem Id', async () => {
    const { privateKeyPem, publicCertPem } = await genTestKeyPair()
    const xmlSemId = RPS_XML_FIXTURE.replace('Id="rps1"', '')

    await expect(signXml(xmlSemId, privateKeyPem, publicCertPem)).rejects.toThrow(
      /sem atributo Id/,
    )
  })

  it.skip('vetor fixo: input X → SignatureValue específico — depende de cert determinístico', async () => {
    // SKIP: regression byte-exact precisaria de um par RSA fixado (commit do
    // PEM no repo, mesmo que dummy). Como não queremos versionar chaves
    // privadas mesmo de teste, validamos só a estrutura. Se quiser ativar:
    //   1. Commitar pair fixo em test/helpers/fixtures/dummy-key.pem
    //   2. Comparar SignatureValue contra string esperada
    //   3. Garantir que C14N é determinístico (é, exceto por ordem de attrs em alguns casos)
  })
})
