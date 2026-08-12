export type FadigaStatus = "saudavel" | "atencao" | "saturado" | "insuficiente";

export type TagNamespace = "manual" | "odin" | "equipe";

/** Tag atribuída a um criativo. `namespace` = de qual catálogo (manual do usuário,
 *  odin/taxonomia IA, equipe/auto-tag agêntica); `source` = quem atribuiu esta ocorrência. */
export interface CriativoTag {
  id: number;
  slug: string;
  label: string;
  color: string | null;
  namespace: TagNamespace;
  source: TagNamespace;
}

export interface CriativoCard {
  ad_id: string;
  /** ad_id do anúncio de MAIOR LUCRO do grupo-por-nome — é o que o "Copiar ID" copia
   *  pra reusar/escalar na campanha (grão: card por nome, ID canônico por lucro). */
  ad_id_canonico: string;
  /** todos os ad_ids do grupo-por-nome — tag aplicada no card vale pro nome inteiro */
  ad_ids: string[];
  /** nº de contas Meta fundidas neste nome (agrupamento por nome exato) */
  num_contas?: number;
  /** dimensões representativas do grupo (1ª ocorrência) — filtro campanha/conjunto/conta + popup */
  campaign_name: string | null;
  adset_name: string | null;
  account_id: string | null;
  /** tags atribuídas (união das tags de todos os ad_ids do grupo-por-nome): manual + odin + equipe */
  tags?: CriativoTag[];
  ad_name: string;
  // Métricas calculadas da meta_ads (janela selecionada)
  hold_rate: number | null; // views_75pct / impressoes (fallback: views_95pct)
  hook_rate: number | null; // views_3seg / impressoes
  ctr: number | null; // cliques_link / impressoes
  /** Conversão do BODY: vendas front ÷ views 75% — de quem assistiu até o fim, quantos compraram.
   *  Isola a força do MIOLO do criativo (o gancho já é medido pelo hook rate).
   *  null = sem views 75% (imagem, ou ninguém chegou lá) — nunca 0%. */
  conv_body: number | null;
  /** Conversão do CLIQUE: vendas front ÷ cliques no link — eficiência do que vem DEPOIS do
   *  anúncio (página + checkout). null = sem clique. */
  conv_clique: number | null;
  /** Comentários no anúncio (actions:comment do Meta, somado na janela). */
  comentarios: number;
  cpa: number | null; // investimento / compras frontEnd
  cpc_link: number | null; // investimento / cliques_link
  cpm: number | null; // investimento / impressoes * 1000
  impressoes: number;
  investimento: number; // = "Gasto" no card
  // Receita / ROAS — cruza meta_ads + transacoes (Hotmart) via aggregateCreatives
  roas: number; // LÍQUIDO: receita líquida Hotmart / investimento
  roasBruto: number; // BRUTO: faturamento bruto / investimento (casa com Meta)
  receita: number; // líquido da operação (bruto − taxas Hotmart)
  vendas: number; // compras frontEnd (de transacoes, não Meta)
  custo_por_checkout: number | null; // investimento / checkouts iniciados (Meta)
  lucro: number; // receita - investimento
  // Fadiga
  fadiga_status: FadigaStatus | null;
  fadiga_calculado_em: string | null;
  // Análise IA
  frames_path: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  instagram_permalink_url: string | null;
  preview_url: string | null; // preview do anúncio no Meta (meta_ads) — mesmo link da aba Criativos
  hook_tipo: string[] | null; // código g + mecanismo (taxonomia DEMO)
  hook_descricao: string | null;
  resumo: string | null;
  transcricao: string | null;
  formato_visual: string[] | null; // SIGLA (POV, TH-CAM, ...) — não o Fxx
  angulo_copy: string[] | null;
  elementos_visuais: string[] | null;
  cta: string[] | null;
  producao: string[] | null;
  estrutura_roteiro: { narrativa: string; confianca: number } | null;
  padroes_detectados: Record<string, unknown> | null;
  nivel_consciencia: string | null;
  momento_funil: string | null;
  promessa_principal: string | null;
}

export interface CriativosListResponse {
  criativos: CriativoCard[];
  total: number;
}
