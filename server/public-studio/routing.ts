// Qual IA do cliente cada etapa usa, e por quê. Precedência (do mais específico ao mais geral):
//   1. a IA escolhida para o agente neste projeto      (project-agent)
//   2. a IA padrão deste projeto                        (project-default)
//   3. a IA atribuída ao agente na conta                (account-agent)
//   4. a IA padrão da conta                             (account-default)
// A escolha mais específica vale mesmo quando a autorização dela expirou: o painel pede para reconectar, e a etapa
// não troca sozinha para outra conta, provedor ou forma de cobrança.
import type { StudioRole } from '../../shared/studio-project';
import { isLocal, LOCAL_PROVIDERS, type Credential, type Provider, type Routing } from './vault';

export type Team = Partial<Record<StudioRole | 'default', Provider>>;
export type ConnectionState = 'available' | 'connected' | 'expired' | 'no_permission' | 'pending_approval' | 'offline' | 'missing';
/** O que o estado depende além da credencial: liberação do ChatGPT e o conector no computador do cliente. */
export type StateContext = { chatgptEnabled: boolean; local: (tool: 'codex' | 'claude') => 'none' | 'offline' | 'online' | 'missing' };
export type RouteSource = 'project-agent' | 'project-default' | 'account-agent' | 'account-default' | 'none';
export type Route = { provider: Provider | null; source: RouteSource; state: ConnectionState | 'none' };

/** Estado de uma IA para esta conta. ChatGPT sem configuração do servidor: aguardando liberação da OpenAI. */
export function connectionState(provider: Provider, credential: Credential | undefined, ctx: StateContext): ConnectionState {
  if (isLocal(provider)) {
    const local = ctx.local(LOCAL_PROVIDERS[provider]);
    return local === 'online' ? 'connected' : local === 'none' ? 'available' : local;
  }
  if (provider === 'chatgpt' && !ctx.chatgptEnabled) return 'pending_approval';
  if (!credential) return 'available';
  if (credential.noPermission) return 'no_permission';
  if (credential.expired) return 'expired';
  return 'connected';
}

export function resolveRoute(
  role: StudioRole,
  team: Team,
  routing: Routing,
  credentials: ReadonlyMap<Provider, Credential>,
  ctx: StateContext,
): Route {
  const candidates: [Provider | undefined, RouteSource][] = [
    [team[role], 'project-agent'],
    [team.default, 'project-default'],
    [routing.assignments[role], 'account-agent'],
    [routing.defaultProvider, 'account-default'],
  ];
  const hit = candidates.find(([provider]) => provider);
  if (!hit?.[0]) return { provider: null, source: 'none', state: 'none' };
  return { provider: hit[0], source: hit[1], state: connectionState(hit[0], credentials.get(hit[0]), ctx) };
}
