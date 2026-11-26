import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createPublicStudio } from './app';

it('isolates authenticated projects, consumes the OAuth flow and revokes sessions on logout', async () => {
  const origin = 'https://studio.example.test';
  const dir = mkdtempSync(join(tmpdir(), 'kodexa-public-'));
  const google = vi.fn<typeof fetch>(async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = init?.body as URLSearchParams;
      return Response.json({ access_token: body.get('code') });
    }
    if (url === 'https://api.openai.com/v1/responses') {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-test-key');
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Pesquisa concluída' }] }] });
    }
    expect(url).toBe('https://openidconnect.googleapis.com/v1/userinfo');
    return Response.json({ sub: new Headers(init?.headers).get('Authorization')?.slice(7) });
  });
  const server = createPublicStudio({ origin, dir, clientId: 'fake', clientSecret: 'fake', fetcher: google });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Invalid test address');
  const request = (path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
    new Promise<Response>((resolve, reject) => {
      const req = httpRequest({
        hostname: '127.0.0.1',
        port: address.port,
        path,
        method: init?.method,
        headers: { Host: new URL(origin).host, ...init?.headers },
      }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const headers = new Headers();
          for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
          resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 500, headers }));
        });
      });
      req.on('error', reject);
      req.end(init?.body);
    });

  async function login(code: string) {
    const start = await request('/public/google');
    const params = new URL(start.headers.get('location')!).searchParams;
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    const flow = start.headers.getSetCookie()[0].split(';')[0];
    const path = '/public/google/callback?' + new URLSearchParams({ code, state: params.get('state')! });
    const result = await request(path, { headers: { Cookie: flow } });
    expect(result.status).toBe(303);
    const session = result.headers.getSetCookie()[1];
    expect(session).toContain('HttpOnly; Secure');
    expect((await request(path, { headers: { Cookie: flow } })).status).toBe(400);
    return session.split(';')[0];
  }

  try {
    expect((await request('/public/projects')).status).toBe(401);
    const first = await login('first');
    const second = await login('second');
    expect((await request('/api/studio', { headers: { Cookie: second } })).status).toBe(404);
    const create = (requestOrigin: string) => request('/public/projects', {
      method: 'POST',
      headers: { Cookie: first, Origin: requestOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: 'Projeto privado para oficina', research: false }),
    });
    expect((await create('https://other.example.test')).status).toBe(403);
    const created = await create(origin);
    expect(created.status).toBe(201);
    const project = await created.json();
    const post = (path: string, session: string, body: unknown) => request(path, {
      method: 'POST',
      headers: { Cookie: session, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const next = '/public/projects/' + project.id + '/next';
    expect((await post(next, first, {})).status).toBe(409);
    const connected = await post('/public/provider', first, { provider: 'openai', model: 'test-model', key: 'private-test-key' });
    expect(await connected.json()).toEqual({ provider: 'openai', model: 'test-model' });
    expect(await (await request('/public/provider', { headers: { Cookie: second } })).json()).toBeNull();
    expect((await post(next, first, {})).status).toBe(202);
    await vi.waitFor(async () => {
      const response = await request('/public/projects', { headers: { Cookie: first } });
      expect((await response.json())[0].state).toBe('approval');
    });
    expect((await post('/public/projects/' + project.id + '/approve', second, { decision: 'Outra conta' })).status).toBe(404);
    expect((await post('/public/projects/' + project.id + '/approve', first, { decision: 'Minha decisão' })).status).toBe(200);
    const list = (session: string) => request('/public/projects', { headers: { Cookie: session } });
    expect(await (await list(first)).json()).toHaveLength(1);
    expect(await (await list(second)).json()).toEqual([]);
    expect((await request('/public/logout', { method: 'POST', headers: { Cookie: first, Origin: origin } })).status).toBe(200);
    expect((await list(first)).status).toBe(401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
