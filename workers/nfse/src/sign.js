// Assina XML ABRASF 2.02 com duas assinaturas xmldsig (RSA-SHA1):
//   1. InfDeclaracaoPrestacaoServico (Id="rpsX") — Signature filha de <Rps>
//   2. LoteRps                       (Id="loteX") — Signature filha de <EnviarLoteRpsSincronoEnvio>
//
// Usa xml-crypto APENAS para canonicalização C14N Inclusive (RFC 3076 + W3C 2001).
// A assinatura RSA é feita com WebCrypto (SubtleCrypto), pois CF Workers não
// expõem crypto.createSign do node:crypto.

import { C14nCanonicalization } from 'xml-crypto'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

const NS_DSIG  = 'http://www.w3.org/2000/09/xmldsig#'
const ALG_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
const ALG_ENV  = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'
const ALG_SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1'
const ALG_RSA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'

export async function signXml(xmlString, privateKeyPem, publicCertPem) {
  const key     = await importPrivateKey(privateKeyPem)
  const certB64 = pemToBase64(publicCertPem)

  let signed = xmlString
  signed = await signEnveloped(signed, key, certB64, 'InfDeclaracaoPrestacaoServico')
  signed = await signEnveloped(signed, key, certB64, 'LoteRps')
  return signed
}

async function signEnveloped(xml, key, certB64, elementName) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const target = findFirstByLocalName(doc, elementName)
  if (!target) throw new Error(`Elemento ${elementName} não encontrado`)

  const refId = target.getAttribute('Id')
  if (!refId) throw new Error(`Elemento ${elementName} sem atributo Id`)

  // 1) Canonicalize o elemento alvo. xmldom já preserva defaultNs herdado no DOM tree
  // então a lib insere xmlns automaticamente sem precisar de ancestorNamespaces explícitos.
  const c14n = new C14nCanonicalization()
  const targetCanonical = c14n.process(target, {})

  // 2) Compute digest do canonical
  const digestB64 = await sha1Base64(targetCanonical)

  // 3) Build SignedInfo (com xmlns dsig explícito)
  const signedInfoXml =
    `<SignedInfo xmlns="${NS_DSIG}">` +
      `<CanonicalizationMethod Algorithm="${ALG_C14N}"/>` +
      `<SignatureMethod Algorithm="${ALG_RSA1}"/>` +
      `<Reference URI="#${refId}">` +
        `<Transforms>` +
          `<Transform Algorithm="${ALG_ENV}"/>` +
          `<Transform Algorithm="${ALG_C14N}"/>` +
        `</Transforms>` +
        `<DigestMethod Algorithm="${ALG_SHA1}"/>` +
        `<DigestValue>${digestB64}</DigestValue>` +
      `</Reference>` +
    `</SignedInfo>`

  // 4) Canonicalize SignedInfo (parse standalone, sem ancestorNamespaces extras)
  const sigDoc = new DOMParser().parseFromString(signedInfoXml, 'text/xml')
  const signedInfoCanonical = new C14nCanonicalization().process(sigDoc.documentElement, {})

  // 5) Sign canonical SignedInfo com RSA-SHA1
  const signatureB64 = await rsaSha1Sign(key, signedInfoCanonical)

  // 6) Compose <Signature>
  const signatureXml =
    `<Signature xmlns="${NS_DSIG}">` +
      signedInfoXml +
      `<SignatureValue>${signatureB64}</SignatureValue>` +
      `<KeyInfo><X509Data><X509Certificate>${certB64}</X509Certificate></X509Data></KeyInfo>` +
    `</Signature>`

  // 7) Injetar a Signature DEPOIS do </elementName> no XML original (string-level)
  return xml.replace(`</${elementName}>`, `</${elementName}>${signatureXml}`)
}

function findFirstByLocalName(doc, localName) {
  const walk = (node) => {
    if (node.nodeType === 1 && node.localName === localName) return node
    for (let i = 0; i < (node.childNodes?.length || 0); i++) {
      const r = walk(node.childNodes[i])
      if (r) return r
    }
    return null
  }
  return walk(doc.documentElement)
}

function collectAncestorNamespaces(node) {
  const result = []
  const seen   = new Set()
  let cur = node.parentNode
  while (cur && cur.nodeType === 1) {
    const attrs = cur.attributes || []
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i]
      if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) {
        const prefix = a.name === 'xmlns' ? '' : a.name.slice(6)
        if (!seen.has(prefix)) {
          seen.add(prefix)
          result.push({ prefix, namespaceURI: a.value })
        }
      }
    }
    cur = cur.parentNode
  }
  return result
}

// === Crypto ===

function pemToBase64(pem) {
  return String(pem)
    .replace(/\\n/g, '\n')
    .replace(/-----[^-]+-----/g, '')
    .replace(/\s/g, '')
}

async function importPrivateKey(pem) {
  const isPkcs1 = pem.includes('RSA PRIVATE KEY')
  const b64 = pemToBase64(pem)
  const buf = Buffer.from(b64, 'base64')
  const der = Uint8Array.from(buf)
  const keyData = isPkcs1 ? pkcs1ToPkcs8(der) : der.buffer
  return crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
    false,
    ['sign']
  )
}

function pkcs1ToPkcs8(pkcs1) {
  const version = new Uint8Array([0x02, 0x01, 0x00])
  const algId = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00])

  function lenBytes(n) {
    if (n < 128) return new Uint8Array([n])
    if (n < 256) return new Uint8Array([0x81, n])
    return new Uint8Array([0x82, (n >> 8) & 0xff, n & 0xff])
  }

  const octetLen = lenBytes(pkcs1.length)
  const innerLen = version.length + algId.length + 1 + octetLen.length + pkcs1.length
  const outerLen = lenBytes(innerLen)

  const out = new Uint8Array(1 + outerLen.length + innerLen)
  let i = 0
  out[i++] = 0x30; out.set(outerLen, i); i += outerLen.length
  out.set(version, i); i += version.length
  out.set(algId,   i); i += algId.length
  out[i++] = 0x04; out.set(octetLen, i); i += octetLen.length
  out.set(pkcs1,   i)
  return out.buffer
}

async function sha1Base64(text) {
  const encoded = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-1', encoded)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
}

async function rsaSha1Sign(key, text) {
  const encoded = new TextEncoder().encode(text)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoded)
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}
