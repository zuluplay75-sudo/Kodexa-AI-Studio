// Escritório público: transforma a atividade da conta (GET /public/activity) no que o escritório original mostra
// para cada agente — status (trabalhando, esperando você, ocioso), a atividade atual, as últimas e o feed. Os agentes
// da equipe padrão têm o id da etapa (scout, manager, ...); agentes criados à mão não têm etapa e ficam ociosos.
import type { Activity, AgentStatus, FeedItem } from '../../../shared/types';

export type RoleActivity = { status: 'working' | 'waiting' | 'idle'; since: number; icon: string; text: string; detail?: string; projectId?: string; waitingFor?: string };
export type FeedEntry = { id: string; role: string; at: number; icon: string; text: string; detail?: string; kind: 'plan' | 'done' | 'error' | 'wait' | 'write' };
export type OfficeActivity = { roles: Record<string, RoleActivity | undefined>; feed: FeedEntry[] };
export type MemberState = { status: AgentStatus; statusSince: number; waitingFor?: string; activity?: Activity; recent: Activity[]; lastEventAt: number };

function activityOf(entry: { id: string; icon: string; text: string; detail?: string; at: number; kind: Activity['kind'] }): Activity {
  return { id: entry.id, kind: entry.kind, icon: entry.icon, text: entry.text.slice(0, 46), ...(entry.detail ? { detail: entry.detail.slice(0, 300) } : {}), at: entry.at };
}

/** Estado de um agente: a atividade dele agora (ou ocioso) e o histórico recente do feed. */
export function memberState(memberId: string, activity: OfficeActivity | undefined, now: number): MemberState {
  const current = activity?.roles[memberId];
  const recent = (activity?.feed ?? []).filter((f) => f.role === memberId).slice(-30)
    .map((f) => activityOf({ id: f.id, icon: f.icon, text: f.text, detail: f.detail, at: f.at, kind: f.kind }));
  if (!current || current.status === 'idle') {
    const last = recent.at(-1);
    return { status: 'idle', statusSince: last?.at ?? now, recent, lastEventAt: last?.at ?? now, ...(last ? { activity: last } : {}) };
  }
  const live = activityOf({ id: memberId + ':agora:' + current.since, icon: current.icon, text: current.text, detail: current.detail, at: current.since, kind: current.status === 'waiting' ? 'wait' : 'plan' });
  return {
    status: current.status,
    statusSince: current.since,
    ...(current.waitingFor ? { waitingFor: current.waitingFor } : {}),
    activity: live,
    recent: [...recent, live].slice(-30),
    lastEventAt: Math.max(current.since, recent.at(-1)?.at ?? 0),
  };
}

/** Itens do feed do escritório para os agentes que existem na equipe (os de outras etapas não aparecem). */
export function feedItems(activity: OfficeActivity | undefined, members: readonly { id: string; name: string }[], roomName: string): FeedItem[] {
  const names = new Map(members.map((m) => [m.id, m.name]));
  return (activity?.feed ?? []).flatMap((f) => {
    const name = names.get(f.role);
    return name ? [{ id: f.id, agentId: f.role, roomId: 'office', agentName: name, roomName, activity: activityOf({ ...f, kind: f.kind }) }] : [];
  });
}
