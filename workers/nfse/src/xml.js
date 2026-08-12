export function buildRpsXml({ numero, serie, competencia, valorServicos, descricao, codigoServico, cnpjPrestador, imPrestador, docTomador, cpfTomador, nomeTomador, emailTomador, municipalityCode = '0000000', tomadorState = 'UF', tomadorPostalCode = '00000000' }) {
  const dt  = competencia ?? new Date().toISOString().split('T')[0]
  const doc = ((docTomador ?? cpfTomador) ?? '').replace(/\D/g, '')
  const tomadorDocTag = doc.length === 14 ? `<Cnpj>${doc}</Cnpj>` : `<Cpf>${doc}</Cpf>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<EnviarLoteRpsSincronoEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">
  <LoteRps Id="lote${numero}" versao="2.02">
    <NumeroLote>${numero}</NumeroLote>
    <CpfCnpj><Cnpj>${cnpjPrestador}</Cnpj></CpfCnpj>
    <InscricaoMunicipal>${imPrestador}</InscricaoMunicipal>
    <QuantidadeRps>1</QuantidadeRps>
    <ListaRps>
      <Rps>
        <InfDeclaracaoPrestacaoServico Id="rps${numero}">
          <Rps>
            <IdentificacaoRps>
              <Numero>${numero}</Numero>
              <Serie>${serie}</Serie>
              <Tipo>1</Tipo>
            </IdentificacaoRps>
            <DataEmissao>${dt}</DataEmissao>
            <Status>1</Status>
          </Rps>
          <Competencia>${dt.slice(0,7)}-01</Competencia>
          <Servico>
            <Valores>
              <ValorServicos>${valorServicos.toFixed(2)}</ValorServicos>
              <Aliquota>2.0000</Aliquota>
            </Valores>
            <IssRetido>2</IssRetido>
            <ItemListaServico>${codigoServico}</ItemListaServico>
            <CodigoCnae>8599604</CodigoCnae>
            <CodigoTributacaoMunicipio>${codigoServico}</CodigoTributacaoMunicipio>
            <Discriminacao>${escapeXml(descricao)}</Discriminacao>
            <CodigoMunicipio>${municipalityCode}</CodigoMunicipio>
            <ExigibilidadeISS>1</ExigibilidadeISS>
            <MunicipioIncidencia>${municipalityCode}</MunicipioIncidencia>
          </Servico>
          <Prestador>
            <CpfCnpj><Cnpj>${cnpjPrestador}</Cnpj></CpfCnpj>
            <InscricaoMunicipal>${imPrestador}</InscricaoMunicipal>
          </Prestador>
          <Tomador>
            <IdentificacaoTomador>
              <CpfCnpj>${tomadorDocTag}</CpfCnpj>
            </IdentificacaoTomador>
            <RazaoSocial>${escapeXml(nomeTomador)}</RazaoSocial>
            <Endereco>
              <Endereco>Nao informado</Endereco>
              <Numero>S/N</Numero>
              <Bairro>Nao informado</Bairro>
              <CodigoMunicipio>${municipalityCode}</CodigoMunicipio>
              <Uf>${tomadorState}</Uf>
              <CodigoPais>1058</CodigoPais>
              <Cep>${tomadorPostalCode}</Cep>
            </Endereco>
            ${emailTomador ? `<Contato><Email>${escapeXml(emailTomador)}</Email></Contato>` : ''}
          </Tomador>
          <RegimeEspecialTributacao>6</RegimeEspecialTributacao>
          <OptanteSimplesNacional>1</OptanteSimplesNacional>
          <IncentivoFiscal>2</IncentivoFiscal>
        </InfDeclaracaoPrestacaoServico>
      </Rps>
    </ListaRps>
  </LoteRps>
</EnviarLoteRpsSincronoEnvio>`;
}

// Códigos ABRASF: 1=Erro emissão, 2=Serviço não prestado, 3=Duplicidade, 4=Erro assinatura, 5=Serviço fora do município
export function buildCancelamentoXml({ numeroNfse, cnpjPrestador, imPrestador, codigoCancelamento = '2', municipalityCode = '0000000' }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<CancelarNfseEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Pedido>
    <InfPedidoCancelamento Id="cancel${numeroNfse}">
      <IdentificacaoNfse>
        <Numero>${numeroNfse}</Numero>
        <CpfCnpj><Cnpj>${cnpjPrestador}</Cnpj></CpfCnpj>
        <InscricaoMunicipal>${imPrestador}</InscricaoMunicipal>
        <CodigoMunicipio>${municipalityCode}</CodigoMunicipio>
      </IdentificacaoNfse>
      <CodigoCancelamento>${codigoCancelamento}</CodigoCancelamento>
    </InfPedidoCancelamento>
  </Pedido>
</CancelarNfseEnvio>`
}

export function buildCabecalho() {
  return `<?xml version="1.0" encoding="UTF-8"?><cabecalho versao="2.02" xmlns="http://www.abrasf.org.br/nfse.xsd"><versaoDados>2.02</versaoDados></cabecalho>`;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
