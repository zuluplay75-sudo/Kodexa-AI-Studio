import { describe, expect, it } from 'vitest';
import { feedItems, memberState, type OfficeActivity } from './office-activity';

const activity: OfficeActivity = {
  roles: { dev: { status: 'working', since: 50, icon: '🛠️', text: 'Construindo no seu computador', detail: 'Projeto "X"' }, scout: { status: 'waiting', since: 40, icon: '✋', text: 'Aguardando sua decisão', waitingFor: 'sua decisão sobre as propostas' } },
  feed: [{ id: 'f1', role: 'scout', at: 30, icon: '✅', text: 'Kodexa Scout concluiu a etapa', kind: 'done' }, { id: 'f2', role: 'qa', at: 31, icon: '✅', text: 'Kodexa QA concluiu a etapa', kind: 'done' }],
};

describe('atividade no escritório público', () => {
  it('agente trabalhando, esperando você e ocioso, com a atividade atual e o histórico', () => {
    expect(memberState('dev', activity, 100)).toMatchObject({ status: 'working', statusSince: 50, activity: { text: 'Construindo no seu computador', kind: 'plan' } });
    const scout = memberState('scout', activity, 100);
    expect(scout).toMatchObject({ status: 'waiting', waitingFor: 'sua decisão sobre as propostas' });
    expect(scout.recent.map((a) => a.text)).toEqual(['Kodexa Scout concluiu a etapa', 'Aguardando sua decisão']);
    expect(memberState('manager', activity, 100)).toEqual({ status: 'idle', statusSince: 100, recent: [], lastEventAt: 100 });
    expect(memberState('dev', undefined, 7).status).toBe('idle');
  });
  it('feed só dos agentes que existem na equipe, com o nome dado pela pessoa', () => {
    const items = feedItems(activity, [{ id: 'scout', name: 'PCIC' }], 'Empresa Ana');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ agentId: 'scout', agentName: 'PCIC', roomName: 'Empresa Ana', activity: { text: 'Kodexa Scout concluiu a etapa' } });
  });
});
