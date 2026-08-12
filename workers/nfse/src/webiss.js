const ENDPOINT_HOMOLOGACAO = 'https://nfse-homologacao.example.com/ws/nfse.asmx';
const ENDPOINT_PRODUCAO    = 'https://nfse.example.com/ws/nfse.asmx';
const WEBISS_TIMEOUT_MS    = 60000; // emissão pode demorar — secretarias são lentas

async function fetchWithTimeout(url, opts = {}, timeoutMs = WEBISS_TIMEOUT_MS) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`WebISS timeout após ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

export async function enviarNfse(cabecalho, dadosXml, producao = false, env = {}) {
  const endpoint = producao
    ? (env.NFSE_ENDPOINT_PRODUCTION || ENDPOINT_PRODUCAO)
    : (env.NFSE_ENDPOINT_STAGING || ENDPOINT_HOMOLOGACAO);
  const action   = '"http://nfse.abrasf.org.br/RecepcionarLoteRpsSincrono"';
  const body     = soapEnvelope(cabecalho, dadosXml, 'RecepcionarLoteRpsSincrono');

  const res  = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': action },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WebISS HTTP ${res.status}: ${text}`);

  return parseResposta(text);
}

function soapEnvelope(cabecalho, dados, operacao) {
  // WSDL form="unqualified" → nfseCabecMsg/nfseDadosMsg precisam de xmlns="" (sair do namespace abrasf)
  // Operação se chama <Operacao>Request com xmlns inline
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${operacao}Request xmlns="http://nfse.abrasf.org.br">
      <nfseCabecMsg xmlns="">${escapeXmlText(cabecalho)}</nfseCabecMsg>
      <nfseDadosMsg xmlns="">${escapeXmlText(dados)}</nfseDadosMsg>
    </${operacao}Request>
  </soap:Body>
</soap:Envelope>`;
}

function escapeXmlText(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function cancelarNfse(cabecalho, dadosXml, producao = false, env = {}) {
  const endpoint = producao
    ? (env.NFSE_ENDPOINT_PRODUCTION || ENDPOINT_PRODUCAO)
    : (env.NFSE_ENDPOINT_STAGING || ENDPOINT_HOMOLOGACAO);
  const action   = '"http://nfse.abrasf.org.br/CancelarNfse"';
  const body     = soapEnvelope(cabecalho, dadosXml, 'CancelarNfse');

  const res  = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': action },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WebISS HTTP ${res.status}: ${text}`);

  // Sucesso: resposta contém DataHoraCancelamento ou Sucesso=true
  const cancelouOk =
    /<DataHoraCancelamento>/.test(text) ||
    /<Sucesso>true<\/Sucesso>/i.test(text);

  if (cancelouOk) return { ok: true, xmlCompleto: text };

  // Erro apenas se não há sinal de sucesso e há mensagem de erro
  const erroMatch = text.match(/<Mensagem>([^<]+)<\/Mensagem>/);
  if (erroMatch) throw new Error(`WebISS cancelamento: ${erroMatch[1]}`);

  // Sem sinal claro de sucesso nem erro — retorna ok com aviso
  return { ok: true, xmlCompleto: text, aviso: 'resposta sem confirmação explícita' };
}

function htmlDecode(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}

function parseResposta(soapXml) {
  // WebIss envolve o XML real dentro de <outputXML> com entidades HTML — decodificar antes de parsear
  const outputMatch = soapXml.match(/<outputXML[^>]*>([\s\S]*?)<\/outputXML>/)
  const innerXml    = outputMatch ? htmlDecode(outputMatch[1].trim()) : soapXml

  const numeroMatch =
    innerXml.match(/<NumeroNfse>(\d+)<\/NumeroNfse>/) ??
    innerXml.match(/<Numero>(\d+)<\/Numero>/);

  const codigoVerificacaoMatch = innerXml.match(/<CodigoVerificacao>([^<]+)<\/CodigoVerificacao>/);

  // Coleta todas as mensagens de erro (pode haver várias dentro de ListaMensagemRetorno)
  const erros = [...innerXml.matchAll(/<Mensagem>([^<]+)<\/Mensagem>/g)].map(m => m[1])

  // P0-02: qualquer resposta sem NumeroNfse precisa lançar — não salvar nota com numero=null
  if (!numeroMatch) {
    if (erros.length) throw new Error(`WebISS erro: ${erros[0]}`)
    throw new Error(`WebISS resposta sem NumeroNfse e sem erro: ${innerXml.slice(0, 500)}`)
  }

  return {
    numero:            numeroMatch[1],
    codigoVerificacao: codigoVerificacaoMatch?.[1] ?? null,
    xmlCompleto:       innerXml,
    warnings:          erros,
  };
}
