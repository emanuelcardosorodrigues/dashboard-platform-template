import type { NextConfig } from "next";

// 'unsafe-eval' só é necessário no dev (Turbopack/HMR usa eval). Em produção o
// código da app não usa eval/new Function (verificado por grep), então removemos
// — fecha o vetor de XSS amplificado por eval sem quebrar o HMR local.
const isDev = process.env.NODE_ENV !== 'production'
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'"

const cspEnforce = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.cdnfonts.com",
  "font-src 'self' https://fonts.gstatic.com https://fonts.cdnfonts.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://graph.facebook.com https://api-sec-vlc.hotmart.com https://developers.hotmart.com",
  "frame-ancestors 'none'",
  // Promovidos do Report-Only (validados, sem violações): o app não usa <object>,
  // não injeta <base>, e todo form-action é relativo (mesma origem).
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join('; ')

// Report-Only: a ÚLTIMA fronteira restante — remover 'unsafe-inline' de script-src
// (o enforce já dropou 'unsafe-eval' em prod e absorveu object-src/base-uri/
// form-action/upgrade). Promover isto a enforce depende de nonce/'strict-dynamic',
// que o Next 16 ainda não expõe em todos os inline scripts; até lá, este canary
// captura violações de script remoto novo, connect-src novo, frame, eval explícito.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.cdnfonts.com",
  "font-src 'self' https://fonts.gstatic.com https://fonts.cdnfonts.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://graph.facebook.com https://api-sec-vlc.hotmart.com https://developers.hotmart.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join('; ')

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Isola browsing context (anti-Spectre/side-channel) e impede que recursos
  // do dash sejam linkados de outras origens.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
  // COEP: require-corp quebra embeds não-cross-origin-isolated — fica pra depois.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'Content-Security-Policy', value: cspEnforce },
  // Report-Only convive com o enforce. Abrir DevTools algumas vezes na semana
  // pra capturar violações antes de promover o cspReportOnly a enforce.
  { key: 'Content-Security-Policy-Report-Only', value: cspReportOnly },
]

const nextConfig: NextConfig = {
  // F3 parte 2 — router cache do CLIENT: revisitar uma página em ≤30s reusa o
  // payload RSC (navegação instantânea, sem tela branca). Seguro porque:
  //  • troca de workspace faz FULL RELOAD (WorkspaceSwitcher) → cache zerado;
  //  • toda mutação/sync usa router.refresh() → invalida;
  //  • filtros (de/ate/funil/conta) são searchParams → entradas separadas.
  // Staleness máxima de 30s ao voltar pra página já vista — aceito no plano.
  experimental: {
    staleTimes: { dynamic: 30 },
    // Tree-shake barrels pesados (recharts ~100kB gz, lucide-react, date-fns) do
    // First Load JS das abas com gráfico/ícones. `optimizePackageImports` é
    // experimental no Next 16 (confirmado no doc) e reescreve os imports de barrel
    // para caminhos diretos — sem mudar código de aplicação.
    optimizePackageImports: ['recharts', 'lucide-react', 'date-fns'],
  },
  // Otimização de imagem SÓ pro nosso bucket (default-deny: nada de host de
  // terceiro). Redimensiona/serve WebP as thumbs JÁ existentes — o <img> cru
  // entregava 58-204KB e era o elemento LCP do /criativos-ia (medido 2,8s no
  // desktop). Restrito ao path público de storage; nenhum outro host entra.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'SEU_PROJECT_REF.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // pdfkit lê os arquivos de fonte .afm via fs.readFileSync(__dirname + '/data/...').
  // Mantê-lo externo preserva o __dirname real (node_modules) em vez do bundle.
  serverExternalPackages: ['googleapis', 'pdfkit'],
  // O tracer estático do Next não enxerga o caminho dinâmico do pdfkit, então
  // os .afm não iam pro bundle da função → ENOENT → /api/raio-x/pdf retornava 500.
  outputFileTracingIncludes: {
    '/api/raio-x/pdf': ['./node_modules/pdfkit/js/data/**/*'],
  },
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        // SW nunca em cache: senão uma versão velha do worker "gruda" e nunca
        // pega o código novo. Service-Worker-Allowed garante escopo raiz.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
};

export default nextConfig;
