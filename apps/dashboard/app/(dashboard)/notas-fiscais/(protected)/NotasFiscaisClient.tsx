'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Pencil, Trash2, Plus, Loader2, FileText, Upload, Settings, List, X, ExternalLink, Ban, FileDown } from 'lucide-react'

type Produto    = { product_id: string; nome: string; percentual: number }
type Aba        = 'emitir' | 'importar' | 'produtos' | 'notas'
type TipoDoc    = 'cpf' | 'cnpj'

const MOTIVOS_CANCELAMENTO = [
  { codigo: '1', label: 'Erro na emissão' },
  { codigo: '2', label: 'Serviço não prestado' },
  { codigo: '3', label: 'Duplicidade da nota' },
  { codigo: '4', label: 'Erro de assinatura' },
  { codigo: '5', label: 'Serviço tomado fora do município' },
]

type Nota = {
  id: number
  numero_rps: string
  numero_nfse: string | null
  doc_tomador: string | null
  nome_tomador: string
  valor: number
  origem: string
  hotmart_id: string | null
  drive_link: string | null
  product_id: string | null
  nome_produto: string | null
  status: string
  criado_em: string
}

type LinhaImport = {
  id: string
  nomeTomador: string
  docTomador: string
  tipoDoc: TipoDoc
  emailTomador: string
  nomeProduto: string
  product_id: string
  valorBruto: number
  percentual: number
  valorNota: number
  selecionada: boolean
  status: 'pendente' | 'emitindo' | 'ok' | 'erro'
  mensagem?: string
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function limparDoc(d: string) { return d.replace(/\D/g, '') }
function detectarTipoDoc(doc: string): TipoDoc { return limparDoc(doc).length === 14 ? 'cnpj' : 'cpf' }

function fmtDoc(doc: string | null): string {
  if (!doc) return '—'
  const d = limparDoc(doc)
  if (d.length === 11) return mascaraDoc(d, 'cpf')
  if (d.length === 14) return mascaraDoc(d, 'cnpj')
  return doc
}

function detectarColuna(headers: string[], candidatos: string[]): number {
  for (const c of candidatos) {
    const i = headers.findIndex(h => h.toLowerCase().includes(c.toLowerCase()))
    if (i >= 0) return i
  }
  return -1
}

function parsearCSV(text: string, produtos: Produto[]): LinhaImport[] {
  const linhas  = text.trim().split(/\r?\n/)
  if (linhas.length < 2) return []
  const sep     = linhas[0].includes(';') ? ';' : ','
  const headers = linhas[0].split(sep).map(h => h.replace(/"/g, '').trim())
  const iNome    = detectarColuna(headers, ['nome do comprador', 'nome'])
  const iEmail   = detectarColuna(headers, ['email do comprador', 'email'])
  const iDoc     = detectarColuna(headers, ['cpf', 'cnpj', 'documento', 'doc'])
  const iValor   = detectarColuna(headers, ['valor da compra', 'preco', 'valor'])
  const iProduto = detectarColuna(headers, ['nome do produto', 'produto'])
  const iProdId  = detectarColuna(headers, ['id do produto', 'product id', 'produto id'])
  const iStatus  = detectarColuna(headers, ['status'])
  return linhas.slice(1).map((linha, idx) => {
    const cols   = linha.split(sep).map(c => c.replace(/"/g, '').trim())
    const status = iStatus >= 0 ? cols[iStatus] : ''
    if (status && !['aprovado','completo','complete','approved','concluido'].some(s => status.toLowerCase().includes(s))) return null
    const valorBruto = parseFloat((cols[iValor] ?? '0').replace(/[R$\s.]/g, '').replace(',', '.')) || 0
    const prodId     = iProdId >= 0 ? cols[iProdId] : ''
    const config     = produtos.find(p => p.product_id === prodId)
    const percentual = config?.percentual ?? 25
    const docRaw     = iDoc >= 0 ? limparDoc(cols[iDoc] ?? '') : ''
    return {
      id: `row-${idx}`,
      nomeTomador:  iNome >= 0  ? cols[iNome]  : '',
      docTomador:   docRaw,
      tipoDoc:      detectarTipoDoc(docRaw),
      emailTomador: iEmail >= 0 ? cols[iEmail] : '',
      nomeProduto:  iProduto >= 0 ? cols[iProduto] : '',
      product_id:   prodId,
      valorBruto,
      percentual,
      valorNota:    +(valorBruto * percentual / 100).toFixed(2),
      selecionada:  true,
      status:       'pendente' as const,
    }
  }).filter(Boolean) as LinhaImport[]
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function NotasFiscaisClient() {
  const [aba, setAba]             = useState<Aba>('emitir')
  const [produtos, setProdutos]   = useState<Produto[]>([])

  const [erroProdutos, setErroProdutos] = useState<string>('')

  useEffect(() => {
    fetch('/api/nfse/produtos')
      .then(async r => {
        if (!r.ok) throw new Error(`worker respondeu ${r.status}`)
        const data = await r.json()
        if (!Array.isArray(data)) throw new Error(data?.erro ?? 'resposta inválida do worker')
        setProdutos(data)
        setErroProdutos('')
      })
      .catch(err => {
        console.error('[nfse/produtos]', err)
        setErroProdutos(err instanceof Error ? err.message : String(err))
      })
  }, [])

  const tabs: { key: Aba; label: string; icon: React.ElementType }[] = [
    { key: 'emitir',   label: 'Emitir nota',    icon: FileText },
    { key: 'importar', label: 'Importar CSV',   icon: Upload   },
    { key: 'notas',    label: 'Notas emitidas', icon: List     },
    { key: 'produtos', label: 'Produtos',        icon: Settings },
  ]

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex gap-1 bg-[#0D1117] border border-[#1F2937] rounded-xl p-1 w-fit flex-wrap">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setAba(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${aba === key ? 'bg-[#1F2937] text-white' : 'text-gray-500 hover:text-gray-300'}`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>
      {erroProdutos && (
        <div className="bg-red-950/40 border border-red-900 rounded-lg px-4 py-3 text-sm text-red-300">
          Não foi possível carregar os produtos cadastrados. <span className="font-mono">{erroProdutos}</span>
          <span className="block mt-1 text-xs text-red-400/80">Tente atualizar a página. Se o problema continuar, contate o suporte técnico.</span>
        </div>
      )}
      {aba === 'emitir'   && <AbaEmitir produtos={produtos} />}
      {aba === 'importar' && <AbaImportar produtos={produtos} />}
      {aba === 'notas'    && <AbaNotas />}
      {aba === 'produtos' && <AbaProdutos produtos={produtos} setProdutos={setProdutos} />}
    </div>
  )
}

// ─── Aba Emitir ───────────────────────────────────────────────────────────────

function mascaraDoc(valor: string, tipo: TipoDoc) {
  const d = valor.replace(/\D/g, '')
  if (tipo === 'cpf') {
    return d.slice(0, 11)
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d{1,2})/, '$1.$2.$3-$4')
  }
  return d.slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d{1,2})/, '$1.$2.$3/$4-$5')
}

function parseBRL(v: string) {
  return parseFloat(v.replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.'))
}

function AbaEmitir({ produtos }: { produtos: Produto[] }) {
  const [tipoDoc, setTipoDoc]   = useState<TipoDoc>('cpf')
  const [form, setForm]         = useState({ product_id: '', nomeTomador: '', docTomador: '', emailTomador: '', valorServicos: '', descricao: '', producao: false })
  const [loading, setLoading]   = useState(false)
  const [resultado, setResultado] = useState<{ ok?: boolean; numeroNfse?: string; driveLink?: string; erro?: string } | null>(null)

  const produtoSelecionado = produtos.find(p => p.product_id === form.product_id)

  function onDocChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(f => ({ ...f, docTomador: mascaraDoc(e.target.value, tipoDoc) }))
  }

  function onTipoDocChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const tipo = e.target.value as TipoDoc
    setTipoDoc(tipo)
    setForm(f => ({ ...f, docTomador: mascaraDoc(f.docTomador, tipo) }))
  }

  function onValorBlur() {
    const n = parseBRL(form.valorServicos)
    if (!isNaN(n) && n > 0)
      setForm(f => ({ ...f, valorServicos: n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }))
  }

  function onValorFocus() {
    const n = parseBRL(form.valorServicos)
    if (!isNaN(n)) setForm(f => ({ ...f, valorServicos: String(n).replace('.', ',') }))
  }

  async function emitir(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setResultado(null)
    const valorNum = parseBRL(form.valorServicos)
    try {
      const res = await fetch('/api/nfse/emitir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, valorServicos: valorNum, docTomador: limparDoc(form.docTomador) }),
      })
      setResultado(await res.json())
    } catch { setResultado({ erro: 'Falha na requisição' }) }
    finally { setLoading(false) }
  }

  function onProdutoChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    const p  = produtos.find(x => x.product_id === id)
    setForm(f => ({
      ...f,
      product_id: id,
      descricao:  p ? `${p.nome} - ${p.percentual}% co-produção` : f.descricao,
    }))
  }

  const placeholder = tipoDoc === 'cnpj' ? '00.000.000/0001-00' : '000.000.000-00'

  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#1F2937]">
        <h2 className="text-sm font-semibold text-white">Emissão manual</h2>
        <p className="text-xs text-gray-500 mt-0.5">Emite uma nota para uma venda específica</p>
      </div>
      <form onSubmit={emitir} className="px-5 py-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Produto</label>
            <select value={form.product_id} onChange={onProdutoChange}
              className="w-full bg-[#0D1117] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500">
              <option value="">Selecionar produto…</option>
              {produtos.map(p => (
                <option key={p.product_id} value={p.product_id}>{p.nome} ({p.percentual}%)</option>
              ))}
            </select>
            {!form.product_id && (
              <p className="text-[11px] text-gray-400 mt-1">Sem seleção, a nota fica sem produto vinculado e usa 25%.</p>
            )}
            {produtoSelecionado && (
              <p className="text-[11px] text-cyan-400/80 mt-1">ID Hotmart: <span className="font-mono">{produtoSelecionado.product_id}</span></p>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nome do comprador</label>
            <input value={form.nomeTomador} onChange={e => setForm(f => ({ ...f, nomeTomador: e.target.value }))} required placeholder="Nome completo"
              className="w-full bg-[#0D1117] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Documento</label>
            <div className="flex gap-2">
              <select value={tipoDoc} onChange={onTipoDocChange}
                className="bg-[#0D1117] border border-[#1F2937] rounded-lg px-2 py-2 text-sm text-gray-400 focus:outline-none focus:ring-1 focus:ring-cyan-500">
                <option value="cpf">CPF</option>
                <option value="cnpj">CNPJ</option>
              </select>
              <input value={form.docTomador} onChange={onDocChange} required placeholder={placeholder} inputMode="numeric"
                className="flex-1 bg-[#0D1117] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">E-mail</label>
            <input value={form.emailTomador} onChange={e => setForm(f => ({ ...f, emailTomador: e.target.value }))} type="email" placeholder="email@exemplo.com"
              className="w-full bg-[#0D1117] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Valor da nota (R$)</label>
            <input value={form.valorServicos} onChange={e => setForm(f => ({ ...f, valorServicos: e.target.value }))}
              onBlur={onValorBlur} onFocus={onValorFocus}
              required inputMode="decimal" placeholder="0,00"
              className="w-full bg-[#0D1117] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Descrição</label>
            <input value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} placeholder="Serviço de instrução/treinamento - Infoproduto"
              className="w-full bg-[#0D1117] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500" />
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer w-fit">
          <input type="checkbox" checked={form.producao} onChange={e => setForm(f => ({ ...f, producao: e.target.checked }))} className="w-4 h-4 rounded accent-cyan-500" />
          <span className="text-sm text-gray-400">Emitir em produção <span className="text-yellow-500">(nota real)</span></span>
        </label>
        {resultado && (
          resultado.ok
            ? <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 space-y-1">
                <p className="text-sm text-green-400">✓ Nota emitida — NFS-e nº {resultado.numeroNfse}</p>
                {resultado.driveLink && (
                  <a href={resultado.driveLink} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline">
                    <ExternalLink size={11} />Ver PDF no Drive
                  </a>
                )}
              </div>
            : <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">Erro: {resultado.erro}</p>
        )}
        <button type="submit" disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors disabled:opacity-50">
          {loading && <Loader2 size={14} className="animate-spin" />}Emitir nota
        </button>
      </form>
    </div>
  )
}

// ─── Aba Importar ─────────────────────────────────────────────────────────────

function AbaImportar({ produtos }: { produtos: Produto[] }) {
  const [linhas, setLinhas]           = useState<LinhaImport[]>([])
  const [processando, setProcessando] = useState(false)
  const [producao, setProducao]       = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setLinhas(parsearCSV(ev.target?.result as string, produtos))
    reader.readAsText(file, 'UTF-8')
  }

  function toggleLinha(id: string)   { setLinhas(ls => ls.map(l => l.id === id ? { ...l, selecionada: !l.selecionada } : l)) }
  function toggleTodas()             { const t = linhas.every(l => l.selecionada); setLinhas(ls => ls.map(l => ({ ...l, selecionada: !t }))) }

  async function emitirLote() {
    const sel = linhas.filter(l => l.selecionada && l.status === 'pendente')
    setProcessando(true)
    for (const l of sel) {
      setLinhas(ls => ls.map(x => x.id === l.id ? { ...x, status: 'emitindo' } : x))
      try {
        const res  = await fetch('/api/nfse/emitir', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nomeTomador: l.nomeTomador, docTomador: l.docTomador, emailTomador: l.emailTomador, valorServicos: l.valorNota, descricao: `${l.nomeProduto} - ${l.percentual}% co-produção`, producao }),
        })
        const data = await res.json()
        setLinhas(ls => ls.map(x => x.id === l.id ? { ...x, status: data.ok ? 'ok' : 'erro', mensagem: data.ok ? `NFS-e nº ${data.numeroNfse}` : data.erro } : x))
      } catch {
        setLinhas(ls => ls.map(x => x.id === l.id ? { ...x, status: 'erro', mensagem: 'Falha na requisição' } : x))
      }
      await new Promise(r => setTimeout(r, 300))
    }
    setProcessando(false)
  }

  const qtd = linhas.filter(l => l.selecionada).length

  return (
    <div className="space-y-4">
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1F2937]">
          <h2 className="text-sm font-semibold text-white">Importar planilha da Hotmart</h2>
          <p className="text-xs text-gray-500 mt-0.5">Exporte as vendas em CSV na Hotmart e faça upload aqui</p>
        </div>
        <div className="px-5 py-4">
          <input ref={inputRef} type="file" accept=".csv" onChange={onFile} className="hidden" />
          <button onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-[#1F2937] hover:border-cyan-500/50 text-gray-400 hover:text-cyan-400 text-sm transition-colors">
            <Upload size={15} />Selecionar arquivo CSV
          </button>
        </div>
      </div>
      {linhas.length > 0 && (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#1F2937] flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-gray-400">
              <span className="text-white font-medium">{linhas.length}</span> compras
              {qtd > 0 && <> · <span className="text-cyan-400 font-medium">{qtd}</span> selecionadas</>}
            </p>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={producao} onChange={e => setProducao(e.target.checked)} className="w-4 h-4 rounded accent-cyan-500" />
                <span className="text-xs text-gray-400">Produção <span className="text-yellow-500">(nota real)</span></span>
              </label>
              <button onClick={emitirLote} disabled={processando || qtd === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors disabled:opacity-50">
                {processando && <Loader2 size={14} className="animate-spin" />}
                Emitir {qtd} nota{qtd !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1F2937] text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2 w-8"><input type="checkbox" checked={linhas.every(l => l.selecionada)} onChange={toggleTodas} className="w-3.5 h-3.5 rounded accent-cyan-500" /></th>
                  <th className="px-4 py-2 text-left font-medium">Comprador</th>
                  <th className="px-4 py-2 text-left font-medium">Doc</th>
                  <th className="px-4 py-2 text-left font-medium">Produto</th>
                  <th className="px-4 py-2 text-right font-medium">Valor bruto</th>
                  <th className="px-4 py-2 text-right font-medium">% / Nota</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(l => (
                  <tr key={l.id} className="border-b border-[#1F2937] last:border-0 hover:bg-[#1F2937]/30 transition-colors">
                    <td className="px-4 py-2 text-center"><input type="checkbox" checked={l.selecionada} onChange={() => toggleLinha(l.id)} disabled={l.status === 'ok'} className="w-3.5 h-3.5 rounded accent-cyan-500" /></td>
                    <td className="px-4 py-2 text-white">{l.nomeTomador}</td>
                    <td className="px-4 py-2 text-gray-400 font-mono">{l.tipoDoc.toUpperCase()} {l.docTomador}</td>
                    <td className="px-4 py-2 text-gray-400 max-w-[140px] truncate">{l.nomeProduto}</td>
                    <td className="px-4 py-2 text-right text-gray-300">{fmtBRL(l.valorBruto)}</td>
                    <td className="px-4 py-2 text-right"><span className="text-gray-500">{l.percentual}%</span> <span className="text-cyan-400 font-medium">{fmtBRL(l.valorNota)}</span></td>
                    <td className="px-4 py-2 max-w-[220px]">
                      {l.status === 'pendente' && <span className="text-gray-500">—</span>}
                      {l.status === 'emitindo' && <span className="text-yellow-400 flex items-center gap-1"><Loader2 size={11} className="animate-spin" />emitindo</span>}
                      {l.status === 'ok'       && <span className="text-green-400">✓ {l.mensagem}</span>}
                      {l.status === 'erro'     && (
                        <span className="text-red-400 block break-words">✗ erro{l.mensagem ? `: ${l.mensagem}` : ''}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Aba Notas Emitidas ───────────────────────────────────────────────────────

function AbaNotas() {
  const [notas, setNotas]           = useState<Nota[]>([])
  const [loading, setLoading]       = useState(true)
  const [preview, setPreview]       = useState<{ nota: Nota; xml: string } | null>(null)
  const [cancelando, setCancelando] = useState<Nota | null>(null)
  const [loadingXml, setLoadingXml] = useState<number | null>(null)

  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro('')
    try {
      const r = await fetch('/api/nfse/notas')
      if (!r.ok) throw new Error(`worker respondeu ${r.status}`)
      const data = await r.json()
      if (!Array.isArray(data)) throw new Error(data?.erro ?? 'resposta inválida do worker')
      setNotas(data)
    } catch (err) {
      console.error('[nfse/notas]', err)
      setErro(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function verPrevia(nota: Nota) {
    setLoadingXml(nota.id)
    try {
      const xml = await fetch(`/api/nfse/notas/${nota.id}/xml`).then(r => r.text())
      setPreview({ nota, xml })
    } finally { setLoadingXml(null) }
  }

  function exportarCSV() {
    const header = ['ID','NFS-e','Comprador','Documento','Produto','Valor','Status','Origem','Data','Drive']
    const rows   = notas.map(n => [
      n.id, n.numero_nfse ?? '', n.nome_tomador, n.doc_tomador ?? '',
      n.nome_produto ?? '', fmtBRL(n.valor), n.status, n.origem, fmtDate(n.criado_em), n.drive_link ?? '',
    ])
    const csv  = [header, ...rows].map(r => r.join(';')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url; a.download = 'notas-fiscais.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1F2937] flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-white">Notas emitidas</h2>
            <p className="text-xs text-gray-500 mt-0.5">{notas.length} nota{notas.length !== 1 ? 's' : ''} no banco</p>
          </div>
          <div className="flex gap-2">
            <button onClick={carregar} className="px-3 py-1.5 rounded-lg border border-[#1F2937] text-gray-400 hover:text-white text-xs transition-colors">Atualizar</button>
            {notas.length > 0 && (
              <button onClick={exportarCSV} className="px-3 py-1.5 rounded-lg bg-[#1F2937] text-gray-300 hover:text-white text-xs transition-colors">Exportar CSV</button>
            )}
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-500"><Loader2 size={18} className="animate-spin" /></div>
        ) : erro ? (
          <div className="px-5 py-8 text-sm text-red-300 bg-red-950/30">
            Não foi possível carregar as notas emitidas. <span className="font-mono">{erro}</span>
            <span className="block mt-1 text-xs text-red-400/80">Clique em &quot;Atualizar&quot; para tentar de novo. Se o problema continuar, contate o suporte técnico.</span>
          </div>
        ) : notas.length === 0 ? (
          <p className="px-5 py-10 text-sm text-gray-500 text-center">Nenhuma nota emitida ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1F2937] text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2 text-left font-medium">NFS-e</th>
                  <th className="px-4 py-2 text-left font-medium">Comprador</th>
                  <th className="px-4 py-2 text-left font-medium">Produto</th>
                  <th className="px-4 py-2 text-right font-medium">Valor</th>
                  <th className="px-4 py-2 text-left font-medium">Data</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {notas.map(n => (
                  <tr key={n.id} className={`border-b border-[#1F2937] last:border-0 transition-colors ${n.status === 'cancelada' ? 'opacity-50' : 'hover:bg-[#1F2937]/30'}`}>
                    <td className="px-4 py-2 font-mono text-cyan-400">{n.numero_nfse ?? <span className="text-gray-400">—</span>}</td>
                    <td className="px-4 py-2">
                      <div className="text-white">{n.nome_tomador}</div>
                      <div className="text-gray-500 font-mono">{fmtDoc(n.doc_tomador)}</div>
                    </td>
                    <td className="px-4 py-2 text-gray-400 max-w-[130px] truncate">{n.nome_produto ?? '—'}</td>
                    <td className="px-4 py-2 text-right text-gray-300">{fmtBRL(n.valor)}</td>
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmtDate(n.criado_em)}</td>
                    <td className="px-4 py-2">
                      {n.status === 'cancelada'
                        ? <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400">cancelada</span>
                        : n.status === 'erro'
                        ? <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/10 text-orange-400">erro</span>
                        : <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/10 text-green-400">emitida</span>
                      }
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => verPrevia(n)} disabled={loadingXml === n.id}
                          className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-[#1F2937] transition-colors" title="Prévia">
                          {loadingXml === n.id ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                        </button>
                        {n.drive_link && (
                          <a href={n.drive_link} target="_blank" rel="noopener noreferrer"
                            className="p-1.5 rounded-md text-gray-500 hover:text-cyan-400 hover:bg-[#1F2937] transition-colors" title="Baixar PDF (Drive)">
                            <FileDown size={12} />
                          </a>
                        )}
                        {n.status !== 'cancelada' && (
                          <button onClick={() => setCancelando(n)}
                            className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Cancelar nota">
                            <Ban size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {preview   && <ModalPrevia nota={preview.nota} xml={preview.xml} onClose={() => setPreview(null)} />}
      {cancelando && <ModalCancelar nota={cancelando} onClose={() => setCancelando(null)} onCancelado={carregar} />}
    </>
  )
}

// ─── Modal Prévia ─────────────────────────────────────────────────────────────

function ModalPrevia({ nota, xml, onClose }: { nota: Nota; xml: string; onClose: () => void }) {
  function extrair(tag: string) {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)<\/${tag}>`))
    return m?.[1] ?? '—'
  }

  const campos = [
    { label: 'NFS-e nº',            valor: nota.numero_nfse ?? extrair('Numero') },
    { label: 'Código de verificação', valor: extrair('CodigoVerificacao') },
    { label: 'Comprador',            valor: nota.nome_tomador },
    { label: 'Documento',            valor: nota.doc_tomador ?? '—' },
    { label: 'Valor',                valor: fmtBRL(nota.valor) },
    { label: 'Discriminação',        valor: extrair('Discriminacao') },
    { label: 'Data emissão',         valor: fmtDate(nota.criado_em) },
    { label: 'Origem',               valor: nota.origem },
  ]

  function baixarXml() {
    const blob = new Blob([xml], { type: 'application/xml' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `nfse-${nota.numero_nfse ?? nota.id}.xml`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#111827] border border-[#1F2937] rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1F2937]">
          <h3 className="text-sm font-semibold text-white">Prévia da NFS-e</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-2">
          {campos.map(({ label, valor }) => (
            <div key={label} className="flex justify-between gap-4 py-1 border-b border-[#1F2937]/50 last:border-0">
              <span className="text-xs text-gray-500 shrink-0">{label}</span>
              <span className="text-xs text-white text-right break-all">{valor}</span>
            </div>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-[#1F2937] flex gap-3 flex-wrap">
          <button onClick={baixarXml}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1F2937] hover:bg-[#374151] text-white text-sm font-medium transition-colors">
            <FileText size={13} />Baixar XML
          </button>
          {nota.drive_link ? (
            <a href={nota.drive_link} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors">
              <FileDown size={13} />Baixar PDF
            </a>
          ) : (
            <button disabled
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1F2937] text-gray-400 text-sm font-medium cursor-not-allowed">
              <FileDown size={13} />Baixar PDF
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal Cancelar ───────────────────────────────────────────────────────────

function ModalCancelar({ nota, onClose, onCancelado }: { nota: Nota; onClose: () => void; onCancelado: () => void }) {
  const [codigo, setCodigo]     = useState('2')
  const [loading, setLoading]   = useState(false)
  const [erro, setErro]         = useState('')

  async function confirmar() {
    setLoading(true); setErro('')
    try {
      const res  = await fetch(`/api/nfse/notas/${nota.id}/cancelar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo }),
      })
      const data = await res.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao cancelar'); return }
      onClose()
      onCancelado()
    } catch { setErro('Falha na requisição') }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#111827] border border-[#1F2937] rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1F2937]">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Ban size={14} className="text-red-400" />Cancelar NFS-e</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
            Esta ação é irreversível. A prefeitura será notificada do cancelamento da NFS-e <strong>{nota.numero_nfse}</strong>.
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Motivo do cancelamento</label>
            <select value={codigo} onChange={e => setCodigo(e.target.value)}
              className="w-full bg-[#0D1117] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500">
              {MOTIVOS_CANCELAMENTO.map(m => (
                <option key={m.codigo} value={m.codigo}>{m.codigo} — {m.label}</option>
              ))}
            </select>
          </div>
          {erro && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{erro}</p>}
        </div>
        <div className="px-5 py-4 border-t border-[#1F2937] flex gap-3">
          <button onClick={confirmar} disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors disabled:opacity-50">
            {loading && <Loader2 size={14} className="animate-spin" />}Confirmar cancelamento
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#1F2937] text-gray-400 hover:text-white text-sm transition-colors">Voltar</button>
        </div>
      </div>
    </div>
  )
}

// ─── Aba Produtos ─────────────────────────────────────────────────────────────

const VAZIO = { product_id: '', nome: '', percentual: 25 }

function AbaProdutos({ produtos, setProdutos }: { produtos: Produto[]; setProdutos: (p: Produto[]) => void }) {
  const [form, setForm]         = useState({ ...VAZIO })
  const [editando, setEditando] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro]         = useState('')

  async function carregar() {
    setLoading(true)
    setErro('')
    try {
      const r = await fetch('/api/nfse/produtos')
      if (!r.ok) throw new Error(`worker respondeu ${r.status}`)
      const data = await r.json()
      if (!Array.isArray(data)) throw new Error(data?.erro ?? 'resposta inválida do worker')
      setProdutos(data)
    } catch (err) {
      console.error('[nfse/produtos]', err)
      setErro(err instanceof Error ? err.message : 'Erro ao carregar')
    } finally {
      setLoading(false)
    }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setSalvando(true); setErro('')
    try {
      const res = await fetch('/api/nfse/produtos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, percentual: Number(form.percentual) }),
      })
      if (!res.ok) throw new Error((await res.json()).erro)
      setForm({ ...VAZIO }); setEditando(false); await carregar()
    } catch (err: unknown) { setErro(err instanceof Error ? err.message : 'Erro') }
    finally { setSalvando(false) }
  }

  async function deletar(product_id: string) {
    if (!confirm('Remover produto?')) return
    await fetch(`/api/nfse/produtos?product_id=${encodeURIComponent(product_id)}`, { method: 'DELETE' })
    await carregar()
  }

  return (
    <div className="space-y-4">
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1F2937]">
          <h2 className="text-sm font-semibold text-white">Produtos cadastrados</h2>
          <p className="text-xs text-gray-500 mt-0.5">Percentual de co-produção por produto</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-24 text-gray-500"><Loader2 size={18} className="animate-spin" /></div>
        ) : produtos.length === 0 ? (
          <p className="px-5 py-8 text-sm text-gray-500 text-center">Nenhum produto. Sem cadastro usa 25%.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1F2937] text-gray-500 text-xs uppercase tracking-wide">
                  <th className="px-5 py-3 text-left font-medium">Produto</th>
                  <th className="px-5 py-3 text-left font-medium">ID</th>
                  <th className="px-5 py-3 text-right font-medium">%</th>
                  <th className="px-5 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {produtos.map(p => (
                  <tr key={p.product_id} className="border-b border-[#1F2937] last:border-0 hover:bg-[#1F2937]/40 transition-colors">
                    <td className="px-5 py-3 text-white font-medium">{p.nome}</td>
                    <td className="px-5 py-3 text-gray-400 font-mono text-xs">{p.product_id}</td>
                    <td className="px-5 py-3 text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400">{p.percentual}%</span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => { setForm({ ...p }); setEditando(true) }} className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-[#1F2937] transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => deletar(p.product_id)} className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1F2937] flex items-center gap-2">
          <Plus size={14} className="text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">{editando ? 'Editar produto' : 'Adicionar produto'}</h2>
        </div>
        <form onSubmit={salvar} className="px-5 py-4 space-y-3">
          {erro && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{erro}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">ID do produto (Hotmart)</label>
              <input value={form.product_id} onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))} readOnly={editando} required placeholder="Ex: PRODUTO_ID_DEMO"
                className="w-full bg-[#0D1117] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 read-only:opacity-50" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Nome do produto</label>
              <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} required placeholder="Produto Demonstrativo"
                className="w-full bg-[#0D1117] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Percentual (%)</label>
              <input type="number" min={1} max={100} step={0.01} value={form.percentual} onChange={e => setForm(f => ({ ...f, percentual: Number(e.target.value) }))} required
                className="w-full bg-[#0D1117] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500" />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={salvando}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors disabled:opacity-50">
              {salvando && <Loader2 size={14} className="animate-spin" />}{editando ? 'Salvar' : 'Adicionar'}
            </button>
            {editando && (
              <button type="button" onClick={() => { setForm({ ...VAZIO }); setEditando(false) }}
                className="px-4 py-2 rounded-lg border border-[#1F2937] text-gray-400 hover:text-white text-sm transition-colors">Cancelar</button>
            )}
          </div>
        </form>
      </div>
      <p className="text-xs text-gray-400">Produtos sem cadastro usam 25% por padrão.</p>
    </div>
  )
}
