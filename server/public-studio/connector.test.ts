// Kodexa Conector (como o codex-bridge do Habblaud original): pareamento por conta, fila de tarefas, presença,
// remoção do computador e a etapa do projeto rodando no "computador do cliente". Tudo simulado: o conector de verdade
// (scripts/kodexa-connector.ts) fala com o servidor por HTTP, mas a ferramenta (Codex/Claude Code) é falsa.
import { once } from 'node:events';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublicStudio } from './app';
import { ConnectorHub } from './connector';
import { authorize, claudeRunner, codexBuildRunner, codexRunner, listFiles, nodeForLauncher, pair, round, type Runner } from '../../scripts/kodexa-connector';

const ORIGIN = 'https://studio.example.test';
const closers: (() => unknown)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
function tempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe('ConnectorHub', () => {
  it('código de uso único, token por computador, remoção e presença', async () => {
    let now = 1_000_000;
    const hub = new ConnectorHub(tempDir('kx-hub-'), () => now);
    const user = 'a'.repeat(64);
    const { code } = hub.pairCode(user);
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const { token } = hub.claim(code.toLowerCase(), 'Notebook <da> Ana');
    expect(() => hub.claim(code, 'outro')).toThrow(/inválido ou vencido/);
    const device = hub.authenticate('Bearer ' + token)!;
    expect(device.user).toBe(user);
    expect(hub.authenticate('Bearer ' + token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).toBeUndefined();
    expect(hub.devices(user)[0].name).toBe('Notebook da Ana');
    expect(JSON.stringify(hub.devices(user))).not.toContain(token.split('.')[3]); // só o hash fica guardado
    expect(hub.status(user, 'codex')).toBe('offline');
    await hub.poll(user, device.deviceId, { codex: true });
    expect(hub.status(user, 'codex')).toBe('online');
    expect(hub.status(user, 'claude')).toBe('missing'); // ligado, mas sem o Claude Code
    now += 46_000;
    expect(hub.status(user, 'codex')).toBe('offline');
    hub.revoke(user, device.deviceId);
    expect(hub.authenticate('Bearer ' + token)).toBeUndefined();
    expect(hub.status(user, 'codex')).toBe('none');
    // Código vencido.
    const late = hub.pairCode(user).code;
    now += 11 * 60_000;
    expect(() => hub.claim(late, 'x')).toThrow(/vencido/);
  });

  it('tarefa: só o computador que pegou confirma; computador desligado nem começa; prazo devolve erro', async () => {
    const hub = new ConnectorHub(tempDir('kx-hub-'));
    const user = 'b'.repeat(64);
    const first = hub.authenticate('Bearer ' + hub.claim(hub.pairCode(user).code, 'um').token)!;
    const second = hub.authenticate('Bearer ' + hub.claim(hub.pairCode(user).code, 'dois').token)!;
    await expect(hub.run(user, 'codex', 'oi')).rejects.toThrow(/desligado/);
    await hub.poll(user, first.deviceId, { codex: true });
    const result = hub.run(user, 'codex', 'planeje');
    const [job] = await hub.poll(user, first.deviceId, { codex: true });
    expect(job).toMatchObject({ tool: 'codex', prompt: 'planeje' });
    expect(await hub.poll(user, second.deviceId, { codex: true })).toEqual([]); // já está com o primeiro
    expect(hub.ack(user, second.deviceId, { id: job.id, ok: true, text: 'intruso' })).toBe(false);
    expect(hub.ack(user, first.deviceId, { id: job.id, ok: true, text: 'plano pronto' })).toBe(true);
    await expect(result).resolves.toBe('plano pronto');
    const failing = hub.run(user, 'codex', 'x');
    const [j2] = await hub.poll(user, first.deviceId, { codex: true });
    hub.ack(user, first.deviceId, { id: j2.id, ok: false, error: 'not logged in\nlinha 2' });
    await expect(failing).rejects.toThrow('O Codex no seu computador não concluiu a tarefa: not logged in linha 2');
    await expect(hub.run(user, 'codex', 'x', 30)).rejects.toThrow(/não devolveu a tarefa a tempo/);
  });

  it('a espera do conector termina quando chega trabalho', async () => {
    const hub = new ConnectorHub(tempDir('kx-hub-'));
    const user = 'c'.repeat(64);
    const d = hub.authenticate('Bearer ' + hub.claim(hub.pairCode(user).code, 'pc').token)!;
    await hub.poll(user, d.deviceId, { claude: true });
    const waiting = hub.poll(user, d.deviceId, { claude: true }, 5_000);
    const result = hub.run(user, 'claude', 'tarefa');
    const jobs = await waiting;
    expect(jobs).toHaveLength(1);
    hub.ack(user, d.deviceId, { id: jobs[0].id, ok: true, text: 'feito' });
    await expect(result).resolves.toBe('feito');
  });
});

async function startStudio() {
  const dir = tempDir('kx-studio-');
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: (init?.body as URLSearchParams).get('code') });
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ sub: new Headers(init?.headers).get('authorization')!.slice(7) });
    throw new Error('Chamada externa inesperada: ' + url); // nenhuma API de IA é chamada neste caminho
  });
  const server = createPublicStudio({ origin: ORIGIN, dir, clientId: 'g', clientSecret: 'g', fetcher });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  closers.push(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
  /** fetch que leva https://studio.example.test/... ao servidor de teste (é o que o conector usa). */
  const local: typeof fetch = (input, init) => new Promise((resolve, reject) => {
    const url = new URL(String(input));
    const headers: Record<string, string> = { Host: url.host };
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    const req = httpRequest({ hostname: '127.0.0.1', port, path: url.pathname + url.search, method: init?.method ?? 'GET', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const out = new Headers();
        for (let i = 0; i < res.rawHeaders.length; i += 2) out.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode!, headers: out }));
      });
    });
    req.on('error', reject);
    req.end(typeof init?.body === 'string' ? init.body : undefined);
  });
  const browser = (session?: string) => (path: string, body?: unknown) => local(ORIGIN + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(session ? { Cookie: session } : {}), ...(body === undefined ? {} : { Origin: ORIGIN, 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function login(code: string) {
    const start = await browser()('/public/google');
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const back = await local(ORIGIN + '/public/google/callback?' + new URLSearchParams({ code, state }), { headers: { Cookie: start.headers.getSetCookie()[0].split(';')[0] } });
    const cookie = back.headers.getSetCookie()[1].split(';')[0];
    return Object.assign(browser(cookie), { cookie });
  }
  return { local, login, dir };
}

describe('Kodexa Conector de ponta a ponta (servidor público + conector real + ferramenta falsa)', () => {
  it('pareia pelo painel, roda a etapa no computador do cliente e mostra o resultado; sem chave de API', async () => {
    const s = await startStudio();
    const ana = await s.login('ana');
    const bia = await s.login('bia');
    // Sem computador pareado: a opção existe, mas está disponível para conectar e não pode ser escolhida ainda.
    const before = await (await ana('/public/provider')).json();
    expect(before.providers.find((p: { provider: string }) => p.provider === 'codex-local').state).toBe('available');
    expect((await ana('/public/provider', { assign: true, role: 'default', provider: 'codex-local' })).status).toBe(400);
    const { code, server } = await (await ana('/public/connector/pair', {})).json();
    expect(server).toBe(ORIGIN);
    const token = await pair(ORIGIN, code, 'Notebook', s.local, { codex: true });
    // Pareado mas ainda sem perguntar: "computador desligado"; o Codex encontrado virou a IA padrão da conta nova.
    const paired = await (await ana('/public/provider')).json();
    expect(paired.providers[0]).toMatchObject({ provider: 'codex-local', state: 'offline' });
    expect(paired.defaultProvider).toBe('codex-local');
    const p = await (await ana('/public/projects', { brief: 'Aplicativo da oficina — teste', research: false })).json();
    const blocked = await ana('/public/projects/' + p.id + '/next', {});
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toBe('Kodexa Scout usa Codex no seu computador pela IA padrão da conta, mas o computador com o Kodexa Conector está desligado ou sem essa ferramenta.');

    const seen: string[] = [];
    const fakeCodex: Runner = async (job) => { seen.push(job.prompt); return { ok: true, text: 'Plano feito pelo Codex do cliente' }; };
    expect(await round(ORIGIN, token, { codex: fakeCodex }, { wait: false, fetcher: s.local })).toBe(0); // marca presença
    expect((await (await ana('/public/connector')).json()).devices[0]).toMatchObject({ name: 'Notebook', online: true, tools: { codex: true, claude: false } });
    expect((await (await ana('/public/connector')).json()).storeUrl).toBeNull(); // sem app publicado, sem link da Store
    expect((await ana('/public/projects/' + p.id + '/next', {})).status).toBe(202);
    expect(await round(ORIGIN, token, { codex: fakeCodex }, { wait: true, fetcher: s.local })).toBe(1);
    await vi.waitFor(async () => {
      const done = (await (await ana('/public/projects')).json())[0];
      expect(done.state).toBe('approval');
      expect(done.stages[0]).toMatchObject({ role: 'scout', provider: 'codex-local', text: 'Plano feito pelo Codex do cliente' });
    });
    expect(seen[0]).toContain('Kodexa Scout');
    expect(seen[0]).toContain('Aplicativo da oficina');

    // A outra conta não vê o computador da Ana, e o token dela não pega trabalho da Bia.
    expect((await (await bia('/public/connector')).json()).devices).toEqual([]);
    expect((await (await bia('/public/provider')).json()).providers[0].state).toBe('available');
    // O conector não usa cookie, e a rota com cookie é recusada (nada de CSRF por ali).
    expect((await s.local(ORIGIN + '/public/connector/poll', { method: 'POST', headers: { Cookie: 'x=1', Authorization: 'Bearer ' + token }, body: '{}' })).status).toBe(400);
    // Remover o computador derruba o token.
    const id = (await (await ana('/public/connector')).json()).devices[0].id;
    expect((await ana('/public/connector/revoke', { id })).status).toBe(200);
    await expect(round(ORIGIN, token, { codex: fakeCodex }, { wait: false, fetcher: s.local })).rejects.toThrow(/não pareado ou removido/);
    // O arquivo de dispositivos não guarda o token.
    for (const f of ['connector-devices.json']) {
      const user = (await import('node:fs')).readdirSync(s.dir).find((d) => d.length === 64 && (() => { try { readFileSync(join(s.dir, d, f)); return true; } catch { return false; } })())!;
      expect(readFileSync(join(s.dir, user, f), 'utf8')).not.toContain(token.split('.')[3]);
    }
  });
});

describe('executores do conector (ferramentas falsas no lugar do codex/claude)', () => {
  it('Codex: exec só leitura, efêmero, pedido pela entrada padrão, resposta do --output-last-message', async () => {
    const dir = tempDir('kx-bin-');
    const bin = join(dir, 'codex');
    // Falso codex: grava os argumentos e a entrada, e escreve a resposta no arquivo pedido.
    writeFileSync(bin, `#!/usr/bin/env node
const fs=require('fs');const a=process.argv.slice(2);let input='';process.stdin.on('data',d=>input+=d).on('end',()=>{
fs.writeFileSync(${JSON.stringify(join(dir, 'args.json'))},JSON.stringify({a,input,cwd:process.cwd()}));
fs.writeFileSync(a[a.indexOf('--output-last-message')+1],'Resposta do Codex: '+input.length+' caracteres');});`);
    chmodSync(bin, 0o755);
    const work = tempDir('kx-work-');
    const result = await codexRunner(bin, work)({ id: '1', tool: 'codex', prompt: '--não-é-opção\nPlaneje a oficina' });
    expect(result).toEqual({ ok: true, text: 'Resposta do Codex: ' + '--não-é-opção\nPlaneje a oficina'.length + ' caracteres' });
    const call = JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8'));
    expect(call.a).toEqual(['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--output-last-message', expect.any(String), '-']);
    expect(call.input).toBe('--não-é-opção\nPlaneje a oficina');
    expect(call.cwd.startsWith(work)).toBe(true);
    expect((await import('node:fs')).readdirSync(work)).toEqual([]); // pasta da tarefa apagada
  });

  it('Claude Code: -p sem aprovar ferramentas e sem guardar sessão; falha vira motivo curto', async () => {
    const dir = tempDir('kx-bin-');
    const ok = join(dir, 'claude');
    writeFileSync(ok, `#!/usr/bin/env node
let i='';process.stdin.on('data',d=>i+=d).on('end',()=>process.stdout.write('ARGS '+process.argv.slice(2).join(' ')+' | '+i));`);
    chmodSync(ok, 0o755);
    const work = tempDir('kx-work-');
    expect(await claudeRunner(ok, work)({ id: '1', tool: 'claude', prompt: 'oi' })).toEqual({ ok: true, text: 'ARGS -p --output-format text --permission-mode dontAsk --no-session-persistence | oi' });
    const bad = join(dir, 'claude-bad');
    writeFileSync(bad, '#!/bin/sh\necho "Not logged in · Please run /login" >&2\nexit 1\n');
    chmodSync(bad, 0o755);
    expect(await claudeRunner(bad, work)({ id: '2', tool: 'claude', prompt: 'oi' })).toEqual({ ok: false, error: 'Not logged in · Please run /login' });
  });
});

describe('Windows: instalador e Codex instalado pelo npm', () => {
  it('instalador .cmd: CRLF, só ASCII, código e origem embutidos, cada goto com rótulo, valores perigosos recusados', async () => {
    const { windowsInstaller } = await import('./windows-installer');
    const cmd = windowsInstaller('https://studio.kodexa.ia.br', 'ABCD-EF23');
    expect(cmd.includes('\r\n')).toBe(true);
    expect(cmd.replace(/\r\n/g, '').includes('\n')).toBe(false);
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(cmd)).toBe(true);
    expect(cmd).toContain('set "KODEXA_CODE=ABCD-EF23"');
    expect(cmd).toContain('curl.exe -fsSL "%KODEXA_SERVER%/public/kodexa-conector.mjs"');
    expect(cmd).toContain('call codex login status');
    for (const [, label] of cmd.matchAll(/goto :(\w+)/g)) expect(cmd).toMatch(new RegExp('^:' + label + '\\r?$', 'm'));
    const opens = (cmd.match(/\($/gm) ?? []).length;
    const closes = (cmd.match(/^\)$/gm) ?? []).length;
    expect(opens).toBe(closes);
    expect(() => windowsInstaller('https://x.test"&calc', 'ABCD-EF23')).toThrow();
    expect(() => windowsInstaller('https://studio.kodexa.ia.br', 'AB%D-EF23')).toThrow();
    expect(() => windowsInstaller('http://studio.kodexa.ia.br', 'ABCD-EF23')).toThrow();
  });

  it('rota do instalador: só com sessão e só pedida pela própria página; o código de dentro pareia', async () => {
    const s = await startStudio();
    const ana = await s.login('ana');
    expect((await s.local(ORIGIN + '/public/connector/windows.cmd')).status).toBe(401);
    // Um link de outro site (o navegador marca Sec-Fetch-Site: cross-site) não gera código, mesmo com o cookie.
    const crossSite = await s.local(ORIGIN + '/public/connector/windows.cmd', { headers: { Cookie: ana.cookie, 'Sec-Fetch-Site': 'cross-site' } });
    expect(crossSite.status).toBe(403);
    const fromPage = await s.local(ORIGIN + '/public/connector/windows.cmd', { headers: { Cookie: ana.cookie, 'Sec-Fetch-Site': 'same-origin' } });
    expect(fromPage.status).toBe(200);
    const res = await ana('/public/connector/windows.cmd');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Instalar Kodexa Conector.cmd"');
    const code = /set "KODEXA_CODE=([A-Z2-9-]+)"/.exec(await res.text())![1];
    expect(await pair(ORIGIN, code, 'PC Windows', s.local, { codex: true })).toMatch(/^kx1\./);
  });

  it('findCodex: no Windows, usa o launcher do pacote npm com o Node (o codex.cmd não roda sem shell)', async () => {
    const { findCodex } = await import('../../scripts/kodexa-connector');
    const launcher = join('C:\\Users\\ana\\AppData\\Roaming', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    const exists = (p: string) => p === launcher;
    expect(findCodex({ PATH: '', APPDATA: 'C:\\Users\\ana\\AppData\\Roaming' }, 'win32', exists, 'C:\\node\\node.exe')).toEqual({ file: 'C:\\node\\node.exe', args: [launcher] });
    expect(findCodex({ PATH: '', APPDATA: 'C:\\Users\\ana\\AppData\\Roaming' }, 'linux', exists)).toBeUndefined();
    expect(findCodex({ KODEXA_CODEX_BIN: '/opt/codex' }, 'linux', (p) => p === '/opt/codex')).toEqual({ file: '/opt/codex', args: [] });
  });

  it('codexRunner com launcher: o Node roda o codex.js antes dos argumentos do exec', async () => {
    const dir = tempDir('kx-bin-');
    const launcher = join(dir, 'codex.js');
    writeFileSync(launcher, `const fs=require('fs');const a=process.argv.slice(2);process.stdin.resume();process.stdin.on('end',()=>fs.writeFileSync(a[a.indexOf('--output-last-message')+1],'via launcher: '+a[0]));`);
    const r = await codexRunner({ file: process.execPath, args: [launcher] }, tempDir('kx-work-'))({ id: '1', tool: 'codex', prompt: 'oi' });
    expect(r).toEqual({ ok: true, text: 'via launcher: exec' });
  });
});

describe('Autorizar este computador (sem código)', () => {
  it('hub: o pedido só vira token com a aprovação da conta; segredo errado não recolhe; uso único; vence', () => {
    let now = 5_000_000;
    const hub = new ConnectorHub(tempDir('kx-hub-'), () => now);
    const user = 'd'.repeat(64);
    const r = hub.createRequest('PC <da> Ana', { codex: true });
    expect(r.id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(r.userCode).toMatch(/^[A-Z2-9]{4}$/);
    expect(hub.describeRequest(r.id)).toEqual({ name: 'PC da Ana', userCode: r.userCode, tools: { codex: true, claude: false } });
    expect(hub.collect(r.id, r.secret)).toEqual({ status: 'pending' });
    hub.approveRequest(user, r.id);
    expect(() => hub.approveRequest('e'.repeat(64), r.id)).toThrow(/inválido ou vencido/); // já aprovado
    expect(hub.collect(r.id, 'segredo-errado')).toEqual({ status: 'expired' });
    const got = hub.collect(r.id, r.secret);
    expect(got.status).toBe('approved');
    expect(hub.authenticate('Bearer ' + (got as { token: string }).token)?.user).toBe(user);
    expect(hub.collect(r.id, r.secret)).toEqual({ status: 'expired' }); // uma vez só
    const old = hub.createRequest('x', {});
    now += 11 * 60_000;
    expect(hub.describeRequest(old.id)).toBeUndefined();
    expect(() => hub.approveRequest(user, old.id)).toThrow(/vencido/);
  });

  it('de ponta a ponta: o conector abre o navegador, a pessoa logada aprova, o conector recebe o token e a IA vira padrão', async () => {
    const s = await startStudio();
    const ana = await s.login('ana');
    const bia = await s.login('bia');
    const opened: string[] = [];
    const token = await authorize(ORIGIN, 'Notebook da Ana', { codex: true }, {
      fetcher: s.local,
      sleep: async () => {},
      open: async (url) => {
        opened.push(url);
        const id = new URL(url).searchParams.get('conectar')!;
        // Sem sessão não dá para ver nem aprovar.
        expect((await s.local(ORIGIN + '/public/connector?request=' + id)).status).toBe(401);
        const seen = await (await ana('/public/connector?request=' + id)).json();
        expect(seen.request).toMatchObject({ name: 'Notebook da Ana', tools: { codex: true, claude: false } });
        expect((await ana('/public/connector/approve', { id })).status).toBe(200);
        expect((await bia('/public/connector/approve', { id })).status).toBe(409); // já é da Ana
        return { ok: true };
      },
    });
    expect(opened[0]).toMatch(/^https:\/\/studio\.example\.test\/public\/\?conectar=[A-Za-z0-9_-]{32}$/);
    expect(token).toMatch(/^kx1\./);
    expect((await (await ana('/public/connector')).json()).devices[0].name).toBe('Notebook da Ana');
    expect((await (await ana('/public/provider')).json()).defaultProvider).toBe('codex-local');
    expect((await (await bia('/public/connector')).json()).devices).toEqual([]);
    expect(await round(ORIGIN, token, { codex: async () => ({ ok: true, text: 'x' }) }, { wait: false, fetcher: s.local })).toBe(0);
  });

  it('o link do navegador só é aceito se apontar para o próprio servidor', async () => {
    const fake: typeof fetch = async () => Response.json({ id: 'a'.repeat(32), secret: 's', userCode: 'ABCD', verifyUrl: 'https://golpe.exemplo/public/?conectar=x', interval: 1 });
    await expect(authorize(ORIGIN, 'pc', { codex: true }, { fetcher: fake, open: async () => ({ ok: true }) })).rejects.toThrow(/não aceitou o pedido/);
  });

  it('no .exe (Node SEA) o launcher do Codex usa o node do PATH, não o próprio executável', () => {
    expect(nodeForLauncher({ PATH: '' }, false)).toBe(process.execPath);
    expect(nodeForLauncher({ PATH: '' }, true)).toBeUndefined();
    expect(nodeForLauncher({ PATH: join(process.execPath, '..') }, true)).toBe(process.execPath);
  });
});

describe('conector sem rede', () => {
  it('falha de conexão vira mensagem em português com o endereço', async () => {
    const offline: typeof fetch = async () => { throw new TypeError('fetch failed'); };
    await expect(pair('https://studio.kodexa.ia.br', 'AAAA-BBBB', 'pc', offline)).rejects.toThrow('Sem conexão com o Kodexa em https://studio.kodexa.ia.br. Confira a internet e tente de novo.');
  });
});

describe('construir o projeto no computador do cliente (item 3) e o escritório ao vivo (item 2)', () => {
  it('planeja as 8 etapas pelo conector, constrói com aprovação, mostra arquivos e a prévia isolada; outra conta não vê', async () => {
    const s = await startStudio();
    const ana = await s.login('ana');
    const bia = await s.login('bia');
    const token = await authorize(ORIGIN, 'Notebook', { codex: true }, { fetcher: s.local, sleep: async () => {}, open: async (url) => {
      await ana('/public/connector/approve', { id: new URL(url).searchParams.get('conectar') }); return { ok: true };
    } });
    const plan: Runner = async (job) => ({ ok: true, text: 'Relatório: ' + (/papel de ([^.]+)\./.exec(job.prompt)?.[1] ?? '?') });
    const p = await (await ana('/public/projects', { brief: 'Agenda da oficina HP — teste', research: false })).json();
    await round(ORIGIN, token, { codex: plan }, { wait: false, fetcher: s.local });

    // Item 2: com a etapa na fila do computador, o Scout aparece trabalhando no escritório.
    expect((await ana('/public/projects/' + p.id + '/next', {})).status).toBe(202);
    await vi.waitFor(async () => expect((await (await ana('/public/activity')).json()).roles.scout).toMatchObject({ status: 'working', text: 'Na fila do seu computador' }));
    await round(ORIGIN, token, { codex: plan }, { wait: true, fetcher: s.local });
    await vi.waitFor(async () => expect((await (await ana('/public/activity')).json()).roles.scout).toMatchObject({ status: 'waiting', text: 'Aguardando sua decisão' }));
    expect((await (await bia('/public/activity')).json()).roles).toEqual({});

    // Construir antes do fim do planejamento: recusado.
    expect((await ana('/public/projects/' + p.id + '/build', { approved: true })).status).toBe(409);
    await ana('/public/projects/' + p.id + '/approve', { decision: 'Agenda simples no navegador' });
    for (let i = 0; i < 7; i++) {
      const r = await ana('/public/projects/' + p.id + '/next', {});
      expect(r.status, await r.clone().text()).toBe(202);
      await round(ORIGIN, token, { codex: plan }, { wait: true, fetcher: s.local });
      await vi.waitFor(async () => expect((await (await ana('/public/projects')).json())[0].state).not.toBe('running'));
    }
    expect((await (await ana('/public/projects')).json())[0].state).toBe('complete');

    // Sem a confirmação explícita, não constrói; com ela, vai para o computador como tarefa de construção.
    expect((await ana('/public/projects/' + p.id + '/build', {})).status).toBe(400);
    expect((await bia('/public/projects/' + p.id + '/build', { approved: true })).status).toBe(404);
    const started = await ana('/public/projects/' + p.id + '/build', { approved: true });
    expect(started.status).toBe(202);
    const folder = (await started.json()).folder;
    expect(folder).toMatch(/^agenda-da-oficina-hp-teste-[0-9a-f]{8}$/);
    expect((await ana('/public/projects/' + p.id + '/build', { approved: true })).status).toBe(409); // já em andamento
    await vi.waitFor(async () => expect((await (await ana('/public/activity')).json()).roles.dev).toMatchObject({ status: 'working' }));
    let received: { kind?: string; folder?: string; prompt: string } | undefined;
    const build: Runner = async (job) => {
      received = job;
      return { ok: true, text: 'Agenda criada. Abra o index.html.', files: [{ path: 'index.html', size: 120 }, { path: 'README.md', size: 40 }, { path: '../fora.txt', size: 1 }], preview: '<!doctype html><h1>Agenda</h1><script>document.title="ok"</script>', folder: '/home/ana/Kodexa/Projetos/' + job.folder };
    };
    await round(ORIGIN, token, { codex: plan, build }, { wait: true, fetcher: s.local });
    expect(received).toMatchObject({ kind: 'build', folder });
    expect(received!.prompt).toContain('Agenda simples no navegador');
    expect(received!.prompt).toContain('Relatório: Kodexa Manager');
    await vi.waitFor(async () => expect((await (await ana('/public/projects')).json())[0].build.state).toBe('done'));
    const done = (await (await ana('/public/projects')).json())[0].build;
    expect(done).toMatchObject({ summary: 'Agenda criada. Abra o index.html.', hasPreview: true, folder: '/home/ana/Kodexa/Projetos/' + folder });
    expect(done.files).toEqual([{ path: 'index.html', size: 120 }, { path: 'README.md', size: 40 }]); // caminho para fora descartado

    // Prévia: página isolada (sandbox, origem opaca), só da conta dona.
    const preview = await ana('/public/projects/' + p.id + '/preview');
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-security-policy')).toMatch(/^sandbox allow-scripts allow-forms allow-modals; default-src 'none'/);
    expect(preview.headers.get('content-security-policy')).not.toContain('allow-same-origin');
    expect(await preview.text()).toContain('<h1>Agenda</h1>');
    expect((await bia('/public/projects/' + p.id + '/preview')).status).toBe(404);
    const activity = await (await ana('/public/activity')).json();
    expect(activity.roles.dev).toBeUndefined();
    expect(activity.feed.at(-1)).toMatchObject({ role: 'dev', text: 'Kodexa Dev entregou 2 arquivos' });
  });

  it('executor de construção: Codex com escrita só na pasta do projeto, lista os arquivos e lê o index.html', async () => {
    const dir = tempDir('kx-bin-');
    const bin = join(dir, 'codex');
    // Codex falso: grava os argumentos, cria arquivos na pasta atual (a do projeto) e responde.
    writeFileSync(bin, `#!/usr/bin/env node
const fs=require('fs');const a=process.argv.slice(2);let input='';process.stdin.on('data',d=>input+=d).on('end',()=>{
fs.writeFileSync(${JSON.stringify(join(dir, 'args.json'))},JSON.stringify({a,cwd:process.cwd()}));
fs.writeFileSync('index.html','<h1>Oi</h1>');fs.mkdirSync('src',{recursive:true});fs.writeFileSync('src/app.js','1');
fs.mkdirSync('node_modules/x',{recursive:true});fs.writeFileSync('node_modules/x/i.js','');fs.writeFileSync('.env','SEGREDO=1');
fs.writeFileSync(a[a.indexOf('--output-last-message')+1],'Feito.');});`);
    chmodSync(bin, 0o755);
    const root = tempDir('kx-projetos-');
    const result = await codexBuildRunner(bin, root)({ id: '1', tool: 'codex', prompt: 'construa', kind: 'build', folder: 'app-oficina-1234abcd' });
    expect(result).toMatchObject({ ok: true, text: 'Feito.', preview: '<h1>Oi</h1>', folder: join(root, 'app-oficina-1234abcd'), files: [{ path: 'index.html', size: 11 }, { path: 'src/app.js', size: 1 }] });
    const call = JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8'));
    expect(call.a).toEqual(['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--output-last-message', expect.any(String), '-']);
    expect(call.cwd).toBe(join(root, 'app-oficina-1234abcd'));
    expect(call.a[8].startsWith(join(root, 'app-oficina-1234abcd'))).toBe(false); // a resposta não fica na pasta do cliente
    expect(await codexBuildRunner(bin, root)({ id: '2', tool: 'codex', prompt: 'x', kind: 'build', folder: '../fora' })).toEqual({ ok: false, error: 'pasta do projeto inválida' });
    expect(listFiles(join(root, 'app-oficina-1234abcd')).map((f) => f.path)).toEqual(['index.html', 'src/app.js']); // sem .env nem node_modules
  });
});
