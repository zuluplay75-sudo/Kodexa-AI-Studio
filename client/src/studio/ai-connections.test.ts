import { describe, expect, it } from 'vitest';
import { assignable, CHOICES, connectorCommands, initialChoice, routeText, stateText, type ProviderInfo } from './ai-connections';

const info = (provider: ProviderInfo['provider'], state: ProviderInfo['state'], extra: Partial<ProviderInfo> = {}): ProviderInfo =>
  ({ provider, state, model: null, account: null, ...extra });

describe('conexões de IA no painel', () => {
  it('a primeira opção é a do original (Codex no computador do cliente), e a padrão de quem já tem uma é preservada', () => {
    expect(CHOICES.slice(0, 3)).toEqual(['codex-local', 'claude-local', 'chatgpt']);
    expect(initialChoice({ defaultProvider: null })).toBe('codex-local');
    expect(initialChoice({ defaultProvider: 'gemini' })).toBe('gemini');
  });
  it('mostrar ChatGPT primeiro não o torna atribuível: só IAs com conexão (inclusive expirada) entram no seletor do agente', () => {
    expect(assignable({ providers: [info('chatgpt', 'pending_approval'), info('gemini', 'connected'), info('openai', 'available'), info('anthropic', 'expired')] }))
      .toEqual(['gemini', 'anthropic']);
  });
  it('estados em português, com a conta e o modelo, sem segredos', () => {
    expect(stateText(info('chatgpt', 'pending_approval'))).toMatch(/^Aguardando liberação da OpenAI\./);
    expect(stateText(info('chatgpt', 'connected', { account: 'ana@exemplo.test', model: 'm1' }))).toBe('Conectada · ana@exemplo.test · modelo m1.');
    expect(stateText(info('gemini', 'expired'))).toMatch(/^Autorização expirada\./);
    expect(stateText(info('openai', 'available'))).toBe('Disponível para conectar.');
  });
  it('IA efetiva do agente no projeto, com a origem da escolha e o problema quando houver', () => {
    expect(routeText('Kodexa Dev', { provider: 'chatgpt', source: 'account-default', state: 'connected' })).toBe('Kodexa Dev usa ChatGPT neste projeto.');
    expect(routeText('Kodexa Scout', { provider: 'gemini', source: 'project-agent', state: 'connected' })).toBe('Kodexa Scout usa Gemini (chave de API) por escolha deste projeto.');
    expect(routeText('Kodexa QA', { provider: 'chatgpt', source: 'project-default', state: 'expired' }))
      .toBe('Kodexa QA usa ChatGPT, a IA padrão deste projeto — autorização expirada; reconecte em Configurar estúdio.');
    expect(routeText('Kodexa Shield', { provider: null, source: 'none', state: 'none' })).toBe('Kodexa Shield ainda não tem IA: conecte uma em Configurar estúdio.');
  });
});

describe('conector no computador do cliente', () => {
  it('computador pareado e desligado continua escolhível (a etapa pede para ligar)', () => {
    expect(assignable({ providers: [info('codex-local', 'offline'), info('claude-local', 'available')] })).toEqual(['codex-local']);
    expect(stateText(info('codex-local', 'available'))).toBe('Nenhum computador pareado.');
    expect(routeText('Kodexa Dev', { provider: 'codex-local', source: 'account-default', state: 'offline' }))
      .toBe('Kodexa Dev usa Codex no seu computador neste projeto — o computador com o Kodexa Conector está desligado.');
  });
  it('comandos de pareamento: baixar o conector do próprio Kodexa e parear com o código', () => {
    expect(connectorCommands('https://studio.kodexa.ia.br', 'ABCD-EFGH', 'codex')).toEqual([
      'curl -fsSL https://studio.kodexa.ia.br/public/kodexa-conector.mjs -o kodexa-conector.mjs',
      'node kodexa-conector.mjs --codigo ABCD-EFGH',
    ]);
    expect(connectorCommands('https://outro.exemplo', 'ABCD-EFGH', 'claude')[1]).toBe('node kodexa-conector.mjs --codigo ABCD-EFGH --servidor https://outro.exemplo --com-claude');
  });
});
