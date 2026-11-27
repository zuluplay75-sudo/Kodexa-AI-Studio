import { describe, expect, it } from 'vitest';
import { assignable, CHOICES, initialChoice, routeText, stateText, type ProviderInfo } from './ai-connections';

const info = (provider: ProviderInfo['provider'], state: ProviderInfo['state'], extra: Partial<ProviderInfo> = {}): ProviderInfo =>
  ({ provider, state, model: null, account: null, ...extra });

describe('conexões de IA no painel', () => {
  it('ChatGPT é a primeira opção, e a padrão de quem já tem uma é preservada', () => {
    expect(CHOICES[0]).toBe('chatgpt');
    expect(initialChoice({ defaultProvider: null })).toBe('chatgpt');
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
