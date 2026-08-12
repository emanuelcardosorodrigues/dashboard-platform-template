/**
 * Schema declarativo dos campos de cada integração por projeto. Fonte única pra:
 *  - renderizar o formulário seguro de credenciais (/admin/projetos/[id]);
 *  - montar o objeto cifrado salvo em workspace_credentials (Onda 4);
 *  - a factory ler os campos certos por provider (Onda 5).
 *
 * `secret: true` → campo sensível (input password / textarea, write-only, nunca
 * exibido de volta). `secret: false` → dica não-sensível (ex: account_id,
 * property_id) — útil de ver, mas guardada junto (cifrada) por simplicidade.
 */
import type { IntegrationProvider } from './credentials'

export interface ProviderField {
  key: string
  label: string
  secret: boolean
  required?: boolean
  textarea?: boolean
  placeholder?: string
}

export const PROVIDER_LABEL: Record<IntegrationProvider, string> = {
  meta: 'Meta Ads',
  vturb: 'vTurb',
  ga4: 'Google Analytics 4',
  clarity: 'Microsoft Clarity',
  hotmart: 'Hotmart',
  cloudflare: 'Cloudflare (A/B + Quiz)',
  nfse: 'NFS-e',
  youtube: 'YouTube (orgânico)',
  instagram: 'Instagram (orgânico)',
  tiktok: 'TikTok (orgânico)',
}

export const PROVIDER_ORDER: IntegrationProvider[] = [
  'meta', 'hotmart', 'vturb', 'ga4', 'clarity', 'cloudflare', 'nfse',
  'youtube', 'instagram', 'tiktok',
]

/**
 * Providers conectados por OAuth: o admin NÃO digita token — clica "Conectar",
 * autoriza na plataforma e o callback grava o token cifrado + organic_accounts.
 * Esses providers não rendem o form de PROVIDER_FIELDS (campos vazios abaixo).
 */
export const PROVIDER_OAUTH: Partial<Record<IntegrationProvider, { startPath: string; hint: string }>> = {
  youtube: {
    startPath: '/api/oauth/youtube/start',
    hint: 'Faça login com a conta dona do canal. Se o canal for uma Conta de Marca, escolha o CANAL (não o e-mail pessoal) na tela do Google.',
  },
  instagram: {
    startPath: '/api/oauth/instagram/start',
    hint: 'Conta Instagram profissional (Business/Creator) vinculada a uma Página do Facebook.',
  },
  tiktok: {
    startPath: '/api/oauth/tiktok/start',
    hint: 'Conta TikTok Business. Disponível após aprovação do app na TikTok for Business.',
  },
}

export const PROVIDER_FIELDS: Record<IntegrationProvider, ProviderField[]> = {
  meta: [
    { key: 'accessToken', label: 'Access Token (System User)', secret: true, required: true },
    { key: 'pageToken', label: 'Page Token (fonte de vídeo, opcional)', secret: true },
    { key: 'accountIds', label: 'Account IDs (separados por vírgula)', secret: false, placeholder: '111111111111111, 222222222222222' },
    { key: 'taxRate', label: 'Tax rate (opcional, ex: 1.1382)', secret: false },
  ],
  hotmart: [
    { key: 'clientId', label: 'Client ID', secret: true, required: true },
    { key: 'clientSecret', label: 'Client Secret', secret: true, required: true },
    { key: 'webhookToken', label: 'Webhook Token (hottok)', secret: true, required: true },
  ],
  vturb: [
    { key: 'apiToken', label: 'API Token (X-Api-Token)', secret: true, required: true },
    { key: 'companyId', label: 'Company ID (opcional)', secret: false },
  ],
  ga4: [
    { key: 'propertyId', label: 'Property ID (numérico)', secret: false, required: true },
    { key: 'serviceAccountEmail', label: 'Service Account Email', secret: false },
    { key: 'privateKey', label: 'Private Key (PEM)', secret: true, textarea: true, placeholder: '-----BEGIN PRIVATE KEY-----\\n...' },
  ],
  clarity: [
    { key: 'apiToken', label: 'API Token (Data Export)', secret: true, required: true },
  ],
  cloudflare: [
    { key: 'apiToken', label: 'API Token', secret: true },
    { key: 'accountId', label: 'Account ID', secret: false },
    { key: 'abKvNamespaceId', label: 'A/B KV Namespace ID', secret: false },
    { key: 'quizKvNamespaceId', label: 'Quiz KV Namespace ID', secret: false },
    { key: 'd1DatabaseId', label: 'D1 Database ID', secret: false },
    { key: 'linksKvNamespaceId', label: 'Links Orgânico — KV Namespace ID', secret: false },
    { key: 'linksDomain', label: 'Links Orgânico — domínio (ex: example.com/l)', secret: false, placeholder: 'dominio.com.br/l' },
  ],
  nfse: [
    { key: 'workerUrl', label: 'Worker URL', secret: false },
    { key: 'apiKey', label: 'API Key', secret: true },
  ],
  // OAuth-only (ver PROVIDER_OAUTH): tokens entram pelo callback, não por form.
  youtube: [],
  instagram: [],
  tiktok: [],
}
