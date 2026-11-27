// O que cada agente da conta está fazendo agora, para o escritório público (como o original mostra as sessões reais
// do Claude Code): trabalhando numa etapa, na fila do computador do cliente, esperando a decisão dele, construindo.
// Tudo sai dos projetos da conta e da fila do Kodexa Conector; nada é inventado. Um agente que não tem etapa em
// andamento fica ocioso.
import { STAGES, type StudioProject, type StudioRole } from '../../shared/studio-project';
import type { JobView } from './connector';

export type BuildRecord = {
  state: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt?: number;
  summary?: string;
  error?: string;
  folder?: string;
  files?: { path: string; size: number }[];
  hasPreview?: boolean;
  device?: string;
};
export type RoleActivity = {
  status: 'working' | 'waiting' | 'idle';
  since: number;
  icon: string;
  text: string;
  detail?: string;
  projectId?: string;
  waitingFor?: string;
};
export type FeedEntry = { id: string; role: StudioRole; at: number; icon: string; text: string; detail?: string; kind: 'plan' | 'done' | 'error' | 'wait' | 'write' };
export type OfficeActivity = { roles: Partial<Record<StudioRole, RoleActivity>>; feed: FeedEntry[] };

const roleName = (role: string) => STAGES.find(([id]) => id === role)?.[1] ?? role;
const short = (text: string, max = 60) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
const time = (iso: string | undefined, fallback: number) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : fallback;
};

export function officeActivity(
  projects: readonly StudioProject[],
  jobs: readonly JobView[],
  builds: ReadonlyMap<string, BuildRecord>,
  providerOf: (projectId: string, role: StudioRole) => string | null,
  now: number,
): OfficeActivity {
  const roles: Partial<Record<StudioRole, RoleActivity>> = {};
  const set = (role: StudioRole, a: RoleActivity) => {
    const cur = roles[role];
    // Trabalho vale mais que espera; entre dois iguais, o mais recente.
    const rank = (s: RoleActivity['status']) => (s === 'working' ? 2 : s === 'waiting' ? 1 : 0);
    if (!cur || rank(a.status) > rank(cur.status) || (rank(a.status) === rank(cur.status) && a.since > cur.since)) roles[role] = a;
  };
  const feed: FeedEntry[] = [];

  for (const p of projects) {
    const name = short(p.brief, 48);
    // Etapas em andamento: no computador do cliente (fila ou rodando) ou numa IA por chave.
    for (const role of p.runningRoles ?? []) {
      const job = jobs.find((j) => j.projectId === p.id && j.role === role && j.kind === 'plan');
      const started = time([...(p.handoffs ?? [])].reverse().find((h) => h.to === role && h.state === 'started')?.at, now);
      if (job?.state === 'queued') {
        set(role, { status: 'working', since: job.since, icon: '⏳', text: 'Na fila do seu computador', detail: 'Projeto "' + name + '": esperando o Kodexa Conector pegar a tarefa.', projectId: p.id });
      } else if (job?.state === 'running') {
        set(role, { status: 'working', since: job.since, icon: '💻', text: 'Planejando no seu computador', detail: 'Projeto "' + name + '" · ' + (job.tool === 'codex' ? 'Codex' : 'Claude Code') + (job.device ? ' em ' + job.device : ''), projectId: p.id });
      } else {
        const provider = providerOf(p.id, role);
        set(role, { status: 'working', since: started, icon: '🧠', text: 'Planejando' + (provider ? ' com ' + provider : ''), detail: 'Projeto "' + name + '"', projectId: p.id });
      }
    }
    // O Scout terminou e o projeto espera a decisão da pessoa: o agente levanta a mão, como no original.
    if (p.state === 'approval') {
      const scout = p.stages.find((s) => s.role === 'scout');
      set('scout', { status: 'waiting', since: time(scout?.at, now), icon: '✋', text: 'Aguardando sua decisão', detail: 'Projeto "' + name + '": escolha uma proposta em Projetos IA.', projectId: p.id, waitingFor: 'sua decisão sobre as propostas' });
    }
    // Construção no computador do cliente: o Dev trabalha.
    const build = builds.get(p.id);
    const buildJob = jobs.find((j) => j.projectId === p.id && j.kind === 'build');
    if (build?.state === 'running') {
      set('dev', {
        status: 'working', since: buildJob?.since ?? build.startedAt, icon: buildJob?.state === 'running' ? '🛠️' : '⏳',
        text: buildJob?.state === 'running' ? 'Construindo no seu computador' : 'Construção na fila do seu computador',
        detail: 'Projeto "' + name + '"' + (buildJob?.device ? ' · em ' + buildJob.device : ''), projectId: p.id,
      });
    }

    for (const stage of p.stages) {
      feed.push({ id: p.id + ':' + stage.role + ':' + stage.at, role: stage.role, at: time(stage.at, now), icon: '✅', kind: 'done', text: roleName(stage.role) + ' concluiu a etapa', detail: 'Projeto "' + name + '"' });
    }
    for (const h of p.handoffs ?? []) {
      if (h.state === 'failed') feed.push({ id: h.id + ':failed', role: h.to, at: time(h.at, now), icon: '⚠️', kind: 'error', text: roleName(h.to) + ' parou: ' + short(p.error ?? 'etapa interrompida', 40), detail: 'Projeto "' + name + '"' });
    }
    if (build) {
      feed.push({ id: p.id + ':build:' + build.startedAt, role: 'dev', at: build.startedAt, icon: '🛠️', kind: 'write', text: 'Kodexa Dev começou a construir', detail: 'Projeto "' + name + '"' });
      if (build.state === 'done' && build.finishedAt) feed.push({ id: p.id + ':build-done:' + build.finishedAt, role: 'dev', at: build.finishedAt, icon: '📦', kind: 'done', text: 'Kodexa Dev entregou ' + (build.files?.length ?? 0) + ' arquivos', detail: 'Projeto "' + name + '"' });
      if (build.state === 'failed' && build.finishedAt) feed.push({ id: p.id + ':build-failed:' + build.finishedAt, role: 'dev', at: build.finishedAt, icon: '⚠️', kind: 'error', text: 'Construção não concluída', detail: short(build.error ?? '', 120) });
    }
  }
  feed.sort((a, b) => a.at - b.at);
  return { roles, feed: feed.slice(-40) };
}
