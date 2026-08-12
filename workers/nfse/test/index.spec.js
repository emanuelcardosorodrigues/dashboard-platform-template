import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";
import { signHmac, makeHotmartRequest } from "./helpers/index.js";

// Env mínimo para os testes. HOTMART_TOKEN ≥ 16 chars pra passar o boot-guard 503.
const HOTMART_SECRET = 'test-hmac-secret-32chars-minimum!!';
const testEnv = {
  ...env,
  API_KEY: 'test-key',
  HOTMART_TOKEN: HOTMART_SECRET,
  COOKIE_HMAC_SECRET: 'test-hmac-secret-32chars-minimum!!',
  ENVIRONMENT: 'staging',
};

describe("Router - auth e rotas basicas", () => {
  it("GET / responde 200", async () => {
    const req = new Request("http://example.com/");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });

  it("GET /admin/login responde 200", async () => {
    const req = new Request("http://example.com/admin/login");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('NFS-e Admin');
  });

  it("GET /admin sem cookie redireciona para login", async () => {
    const req = new Request("http://example.com/admin");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('/admin/login');
  });

  it("GET /api/notas sem API key retorna 401", async () => {
    const req = new Request("http://example.com/api/notas");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('erro');
  });

  it("GET /api/notas com API key errada retorna 401", async () => {
    const req = new Request("http://example.com/api/notas", {
      headers: { 'x-api-key': 'wrong-key' },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("OPTIONS /api/produtos retorna 204 (CORS preflight sem key)", async () => {
    const req = new Request("http://example.com/api/produtos", {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(204);
  });

  it("POST /webhook/hotmart sem x-hotmart-signature retorna 401", async () => {
    const req = new Request("http://example.com/webhook/hotmart", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'PURCHASE_APPROVED' }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /webhook/hotmart com HMAC válido mas evento ignorado retorna ok", async () => {
    const payload = { event: 'PURCHASE_REFUNDED', data: { product: { id: '123' } } };
    const body = JSON.stringify(payload);
    const sig = await signHmac(body, HOTMART_SECRET);
    const req = new Request("http://example.com/webhook/hotmart", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hotmart-signature': sig,
      },
      body,
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    // PURCHASE_REFUNDED é evento de cancelamento → entra no handleHotmartCancelamento.
    // Sem transaction_id no payload, devolve 200 com ignorado.
    expect(res.status).toBe(200);
  });
});
