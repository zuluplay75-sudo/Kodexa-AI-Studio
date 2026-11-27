// Conexões de IA da conta no escritório público (dentro de Configurar estúdio › Conexões e limites das IAs) e o
// texto da IA efetiva de cada agente em Projetos IA. O servidor (server/public-studio) decide estados e precedência;
// aqui só se mostra e se pede a ação. Nenhuma chave ou token chega a esta página: só estado, modelo e a conta.
export type ProviderId = 'chatgpt' | 'openai' | 'anthropic' | 'gemini';
export type ProviderState = 'available' | 'connected' | 'expired' | 'no_permission' | 'pending_approval';
export type ProviderInfo = { provider: ProviderId; state: ProviderState; model: string | null; account: string | null };
export type Settings = { persistent: boolean; providers: ProviderInfo[]; defaultProvider: ProviderId | null; assignments: Record<string, ProviderId> };
export type RouteSource = 'project-agent' | 'project-default' | 'account-agent' | 'account-default' | 'none';
export type Route = { provider: ProviderId | null; source: RouteSource; state: ProviderState | 'none' };

/** Ordem do seletor: ChatGPT primeiro; Claude Code aparece só como explicação (roda no computador do cliente). */
export const CHOICES = ['chatgpt', 'anthropic', 'gemini', 'openai', 'claude-code'] as const;
export type Choice = typeof CHOICES[number];

export const LABEL: Record<ProviderId, string> = {
  chatgpt: 'ChatGPT',
  openai: 'OpenAI (chave de API)',
  anthropic: 'Claude (chave de API)',
  gemini: 'Gemini (chave de API)',
};
export const CHOICE_LABEL: Record<Choice, string> = {
  chatgpt: 'ChatGPT — seu plano ChatGPT',
  anthropic: 'Claude — chave de API da Anthropic',
  gemini: 'Gemini — chave de API do Google AI Studio',
  openai: 'OpenAI por chave de API (avançado)',
  'claude-code': 'Claude Code — no seu computador',
};
export const DEFAULT_MODEL: Record<Exclude<ProviderId, 'chatgpt'>, string> = {
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-sonnet-4-5',
  gemini: 'gemini-2.5-flash',
};

/** O que a pessoa precisa fazer e o que vai executar as tarefas, por opção. */
export const GUIDE: Record<Choice, string> = {
  chatgpt:
    'Você autoriza o Kodexa a usar o seu plano do ChatGPT (Plus ou Pro) nas tarefas dos agentes. O uso conta nos limites do seu plano, sem cobrança por API. ' +
    'O Kodexa não acessa seus projetos, arquivos nem conversas do ChatGPT, e você pode desconectar quando quiser.',
  anthropic:
    'Crie uma chave de API em console.anthropic.com e cole abaixo. Cada tarefa é cobrada por uso na sua conta da Anthropic. ' +
    'O login do Claude.ai (planos Pro e Max) não pode ser usado por outros sites, então o Kodexa usa a chave de API.',
  gemini:
    'Crie uma chave de API no Google AI Studio e cole abaixo. Entrar no Kodexa com Google não autoriza o Gemini: a chave é separada. ' +
    'Alguns modelos têm nível gratuito, com limites menores, e nele o Google pode usar o conteúdo para melhorar seus produtos; ' +
    'confira os limites e preços do seu projeto em ai.google.dev antes de escolher.',
  openai:
    'Opção avançada para quem já usa a API da OpenAI: crie uma chave em platform.openai.com. A cobrança é por uso na sua conta de API, separada do plano ChatGPT.',
  'claude-code':
    'O Claude Code roda no seu computador, com a sua própria conta. O site hospedado não executa o Claude Code por você nem usa a sessão de outra pessoa. ' +
    'Para usá-lo, instale e entre no Claude Code no seu computador; para os agentes daqui, escolha uma das outras IAs.',
};

export function stateText(info: ProviderInfo): string {
  switch (info.state) {
    case 'pending_approval':
      return 'Aguardando liberação da OpenAI. A OpenAI ainda não liberou o uso do plano ChatGPT em sites hospedados como o Kodexa. Enquanto isso, você pode usar outra IA.';
    case 'available':
      return 'Disponível para conectar.';
    case 'connected':
      return 'Conectada' + (info.account ? ' · ' + info.account : '') + (info.model ? ' · modelo ' + info.model : '') + '.';
    case 'expired':
      return 'Autorização expirada. Reconecte para os agentes voltarem a usar esta IA; suas escolhas continuam salvas.';
    case 'no_permission':
      return 'A conta foi identificada, mas não liberou o uso do plano para tarefas. Reconecte e aceite o uso do plano.';
  }
}

/** IA escolhida ao abrir o seletor: a padrão de quem já tem uma; para conta nova, ChatGPT (sem marcar como conectada). */
export function initialChoice(settings: Pick<Settings, 'defaultProvider'>): Choice {
  return settings.defaultProvider ?? 'chatgpt';
}

/** Pode ser escolhida para um agente: já tem conexão (mesmo expirada, para manter a escolha e pedir reconexão). */
export function assignable(settings: Pick<Settings, 'providers'>): ProviderId[] {
  return settings.providers.filter((p) => p.state === 'connected' || p.state === 'expired' || p.state === 'no_permission').map((p) => p.provider);
}

const PROBLEM: Partial<Record<Route['state'], string>> = {
  expired: 'autorização expirada; reconecte em Configurar estúdio',
  no_permission: 'a conta não liberou o uso para tarefas; reconecte em Configurar estúdio',
  available: 'desconectada; conecte em Configurar estúdio',
  pending_approval: 'aguardando liberação da OpenAI',
};

/** "Kodexa Dev usa ChatGPT neste projeto", "Kodexa Scout usa Gemini por escolha deste projeto"... */
export function routeText(agent: string, route: Route): string {
  if (!route.provider) return agent + ' ainda não tem IA: conecte uma em Configurar estúdio.';
  const label = LABEL[route.provider];
  const base =
    route.source === 'project-agent' ? agent + ' usa ' + label + ' por escolha deste projeto' :
    route.source === 'project-default' ? agent + ' usa ' + label + ', a IA padrão deste projeto' :
    route.source === 'account-agent' ? agent + ' usa ' + label + ' neste projeto (atribuição do agente na conta)' :
    agent + ' usa ' + label + ' neste projeto';
  const problem = PROBLEM[route.state];
  return base + (problem ? ' — ' + problem + '.' : '.');
}
