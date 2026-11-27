// Conexões de IA da conta no escritório público (dentro de Configurar estúdio › Conexões e limites das IAs) e o
// texto da IA efetiva de cada agente em Projetos IA. O servidor (server/public-studio) decide estados e precedência;
// aqui só se mostra e se pede a ação. Nenhuma chave ou token chega a esta página: só estado, modelo e a conta.
export type ProviderId = 'codex-local' | 'claude-local' | 'chatgpt' | 'openai' | 'anthropic' | 'gemini';
export type ProviderState = 'available' | 'connected' | 'expired' | 'no_permission' | 'pending_approval' | 'offline' | 'missing';
export type Device = { id: string; name: string; createdAt: number; online: boolean; tools: { codex: boolean; claude: boolean } };
export type ProviderInfo = { provider: ProviderId; state: ProviderState; model: string | null; account: string | null };
export type Settings = { persistent: boolean; providers: ProviderInfo[]; defaultProvider: ProviderId | null; assignments: Record<string, ProviderId> };
export type RouteSource = 'project-agent' | 'project-default' | 'account-agent' | 'account-default' | 'none';
export type Route = { provider: ProviderId | null; source: RouteSource; state: ProviderState | 'none' };

/**
 * Ordem do seletor. Primeiro o jeito do Habblaud original: a IA roda no computador do cliente, com o Codex ou o
 * Claude Code dele (sem chave de API). Depois o ChatGPT direto (quando a OpenAI liberar) e as chaves de API.
 */
export const CHOICES = ['codex-local', 'claude-local', 'chatgpt', 'anthropic', 'gemini', 'openai'] as const;
export type Choice = typeof CHOICES[number];
export const LOCAL: readonly ProviderId[] = ['codex-local', 'claude-local'];

export const LABEL: Record<ProviderId, string> = {
  'codex-local': 'Codex no seu computador',
  'claude-local': 'Claude Code no seu computador',
  chatgpt: 'ChatGPT',
  openai: 'OpenAI (chave de API)',
  anthropic: 'Claude (chave de API)',
  gemini: 'Gemini (chave de API)',
};
export const CHOICE_LABEL: Record<Choice, string> = {
  'codex-local': 'Codex no seu computador — plano ChatGPT, sem chave',
  'claude-local': 'Claude Code no seu computador — plano Claude, sem chave',
  chatgpt: 'ChatGPT direto — seu plano ChatGPT',
  anthropic: 'Claude — chave de API da Anthropic',
  gemini: 'Gemini — chave de API do Google AI Studio',
  openai: 'OpenAI por chave de API (avançado)',
};
export const DEFAULT_MODEL: Record<'openai' | 'anthropic' | 'gemini', string> = {
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-sonnet-4-5',
  gemini: 'gemini-2.5-flash',
};

/** O que a pessoa precisa fazer e o que vai executar as tarefas, por opção. */
export const GUIDE: Record<Choice, string> = {
  'codex-local':
    'Os agentes usam o Codex do seu computador, logado na sua conta do ChatGPT: o uso conta no seu plano, sem chave e sem cobrança de API. ' +
    'Baixe e abra o Kodexa Conector: ele instala o Codex oficial se faltar, abre o login do ChatGPT e pede para você autorizar este computador. ' +
    'As tarefas rodam no seu computador, numa pasta só do Kodexa; ele precisa estar ligado com o conector aberto.',
  'claude-local':
    'Os agentes usam o Claude Code do seu computador, logado na sua conta Claude: o uso conta no seu plano, sem chave de API. ' +
    'Instale e entre no Claude Code, pareie o computador com o código abaixo e abra o conector com --com-claude. ' +
    'Confira os termos de uso do seu plano Claude para uso automatizado. O computador precisa estar ligado com o conector aberto.',
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
};

export function stateText(info: ProviderInfo): string {
  switch (info.state) {
    case 'pending_approval':
      return 'Aguardando liberação da OpenAI. A OpenAI ainda não liberou o uso do plano ChatGPT em sites hospedados como o Kodexa. Enquanto isso, você pode usar outra IA.';
    case 'available':
      return LOCAL.includes(info.provider) ? 'Nenhum computador pareado.' : 'Disponível para conectar.';
    case 'offline':
      return 'Computador pareado, mas desligado ou sem o conector aberto.';
    case 'missing':
      return info.provider === 'claude-local'
        ? 'Computador ligado, mas o conector está sem o Claude Code. Instale e entre no Claude Code e abra o conector com --com-claude.'
        : 'Computador ligado, mas o conector não encontrou o Codex. Instale o Codex e entre com "codex login".';
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
  return settings.defaultProvider ?? 'codex-local';
}

/** Pode ser escolhida para um agente: já tem conexão (mesmo expirada, para manter a escolha e pedir reconexão). */
export function assignable(settings: Pick<Settings, 'providers'>): ProviderId[] {
  return settings.providers.filter((p) => p.state === 'connected' || p.state === 'expired' || p.state === 'no_permission' || p.state === 'offline' || p.state === 'missing').map((p) => p.provider);
}

const PROBLEM: Partial<Record<Route['state'], string>> = {
  expired: 'autorização expirada; reconecte em Configurar estúdio',
  no_permission: 'a conta não liberou o uso para tarefas; reconecte em Configurar estúdio',
  available: 'desconectada; conecte em Configurar estúdio',
  pending_approval: 'aguardando liberação da OpenAI',
  offline: 'o computador com o Kodexa Conector está desligado',
  missing: 'o conector do seu computador está sem essa ferramenta',
};

export type Platform = 'windows' | 'mac' | 'linux';
/** Sistema do computador em que a página está aberta (para mostrar o instalador e os comandos certos). */
export function platformOf(userAgent: string, uaPlatform = ''): Platform {
  const v = (uaPlatform + ' ' + userAgent).toLowerCase();
  if (v.includes('win')) return 'windows';
  if (v.includes('mac')) return 'mac';
  return 'linux';
}

/**
 * Comandos para o cliente rodar no computador dele (baixar o conector do próprio Kodexa e parear com o código), no
 * formato do terminal de cada sistema. No PowerShell, `curl` é outro comando: lá vai `curl.exe`.
 */
export function connectorCommands(server: string, code: string, tool: 'codex' | 'claude', platform: Platform = 'linux'): { terminal: string; lines: string[] }[] {
  const run = 'node kodexa-conector.mjs --codigo ' + code + (server === 'https://studio.kodexa.ia.br' ? '' : ' --servidor ' + server) + (tool === 'claude' ? ' --com-claude' : '');
  const download = (curl: string) => curl + ' -fsSL ' + server + '/public/kodexa-conector.mjs -o kodexa-conector.mjs';
  if (platform === 'windows') {
    return [
      { terminal: 'Prompt de Comando (cmd)', lines: [download('curl'), run] },
      { terminal: 'PowerShell', lines: [download('curl.exe'), run] },
    ];
  }
  return [{ terminal: platform === 'mac' ? 'Terminal do Mac' : 'Terminal', lines: [download('curl'), run] }];
}

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
