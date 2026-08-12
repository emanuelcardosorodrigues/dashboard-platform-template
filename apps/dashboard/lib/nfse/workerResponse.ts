/**
 * Lê a resposta do Worker NFS-e (WebIss) com segurança.
 *
 * Antes: `await res.json()` direto — se o Worker devolve não-JSON (erro upstream,
 * HTML de proxy/Cloudflare, corpo vazio num 5xx), o `.json()` estoura e a rota
 * responde 500 com stack, mascarando o erro real. Aqui devolvemos SEMPRE um objeto
 * estruturado, sem repassar corpo bruto do Worker (pode conter detalhe interno).
 */
export async function readWorkerJson(res: Response): Promise<{ status: number; data: unknown }> {
  const text = await res.text().catch(() => '')
  if (!text) {
    return res.ok
      ? { status: res.status, data: {} }
      : { status: res.status, data: { error: `Serviço de NFS-e retornou ${res.status} sem corpo.` } }
  }
  try {
    return { status: res.status, data: JSON.parse(text) }
  } catch {
    // não-JSON: não repassa o corpo (pode ser HTML/erro interno); reporta 502.
    return { status: res.ok ? 502 : res.status, data: { error: 'Resposta inválida do serviço de NFS-e (não-JSON).', upstreamStatus: res.status } }
  }
}
