import { describe, expect, it } from 'vitest';
import type { StudioProject } from '../../shared/studio-project';
import { officeActivity, type BuildRecord } from './activity';
import type { JobView } from './connector';

const base = (over: Partial<StudioProject>): StudioProject => ({ id: 'p1', brief: 'App da oficina', research: false, stages: [], state: 'new', createdAt: '2026-11-27T10:00:00.000Z', ...over });
const label = () => 'Codex no seu computador';

describe('officeActivity: o que cada agente faz agora (dados reais dos projetos e da fila)', () => {
  it('etapa na fila do computador, rodando no computador e numa IA por chave', () => {
    const projects = [
      base({ id: 'a', state: 'running', runningRoles: ['scout'] }),
      base({ id: 'b', state: 'running', runningRoles: ['manager'] }),
      base({ id: 'c', state: 'running', runningRoles: ['design'], handoffs: [{ id: 'h', phase: 'planning', to: 'design', from: [], at: '2026-11-27T10:05:00.000Z', state: 'started' }] }),
    ];
    const jobs: JobView[] = [
      { projectId: 'a', role: 'scout', kind: 'plan', tool: 'codex', state: 'queued', since: 1000 },
      { projectId: 'b', role: 'manager', kind: 'plan', tool: 'codex', state: 'running', since: 2000, device: 'Notebook' },
    ];
    const r = officeActivity(projects, jobs, new Map(), (id) => (id === 'c' ? 'Gemini (chave de API)' : label()), 9999);
    expect(r.roles.scout).toMatchObject({ status: 'working', text: 'Na fila do seu computador', since: 1000 });
    expect(r.roles.manager).toMatchObject({ status: 'working', text: 'Planejando no seu computador', detail: 'Projeto "App da oficina" · Codex em Notebook' });
    expect(r.roles.design).toMatchObject({ status: 'working', text: 'Planejando com Gemini (chave de API)', since: Date.parse('2026-11-27T10:05:00.000Z') });
    expect(r.roles.dev).toBeUndefined(); // sem etapa: ocioso
  });

  it('projeto esperando a decisão: o Scout levanta a mão; construção em andamento: o Dev trabalha; feed em ordem', () => {
    const projects = [
      base({ id: 'a', state: 'approval', stages: [{ role: 'scout', text: 'x', sources: [], at: '2026-11-27T11:00:00.000Z' }] }),
      base({ id: 'b', state: 'complete', stages: [{ role: 'manager', text: 'y', sources: [], at: '2026-11-27T09:00:00.000Z' }] }),
    ];
    const builds = new Map<string, BuildRecord>([['b', { state: 'running', startedAt: Date.parse('2026-11-27T12:00:00.000Z'), folder: 'app-b' }]]);
    const r = officeActivity(projects, [{ projectId: 'b', kind: 'build', tool: 'codex', state: 'running', since: 5, device: 'PC' }], builds, label, 0);
    expect(r.roles.scout).toMatchObject({ status: 'waiting', text: 'Aguardando sua decisão', waitingFor: 'sua decisão sobre as propostas' });
    expect(r.roles.dev).toMatchObject({ status: 'working', text: 'Construindo no seu computador', since: 5 });
    expect(r.feed.map((f) => f.text)).toEqual(['Kodexa Manager concluiu a etapa', 'Kodexa Scout concluiu a etapa', 'Kodexa Dev começou a construir']);
  });
});
