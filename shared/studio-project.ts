export const STAGES = [
  ['scout', 'Kodexa Scout', 'Pesquisa de campo: entenda o objetivo, proponha alternativas e compare concorrentes, público, riscos e diferenciais. Se houver pesquisa web, cite fontes verificadas; se não houver, não alegue ter pesquisado.'],
  ['manager', 'Kodexa Manager', 'Transforme a decisão aprovada em requisitos, arquitetura inicial, tarefas, dependências, critérios de aceite e prioridades.'],
  ['academy', 'Kodexa Academy', 'Identifique conhecimentos técnicos necessários, documentação de referência e lacunas; não afirme ter assistido vídeos ou acessado fontes que não recebeu.'],
  ['design', 'Kodexa Design', 'Defina experiência, direção de arte, interface, acessibilidade, assets e especificações de design.'],
  ['network', 'Kodexa Network', 'Projete infraestrutura, dados, APIs, autenticação, rede e implantação, com limites e custos.'],
  ['dev', 'Kodexa Dev', 'Prepare plano de implementação e instruções técnicas executáveis para uma sessão de programação real. Não afirme ter editado arquivos.'],
  ['qa', 'Kodexa QA', 'Prepare plano de testes, casos de erro e critérios de regressão. Não afirme que testes foram executados.'],
  ['shield', 'Kodexa Shield', 'Faça revisão de riscos do plano, ameaças, isolamento, permissões, segredos e verificações de segurança. Não afirme que o código foi auditado.'],
] as const;
export type StudioRole = typeof STAGES[number][0];
export const AI_PROVIDERS=['default','codex-cli','claude-cli','gemini'] as const;
export type StudioAI=typeof AI_PROVIDERS[number];
export type ManagedAI=Exclude<StudioAI,'default'>;
export type StudioRouting={roles:Record<StudioRole,StudioAI>;fallback:boolean;dailyLimit:number};
export type AIStatus={id:ManagedAI;configured:boolean;state:'untested'|'ok'|'failed';message:string;calls:number;at?:string};
export type RoutingInfo={routing:StudioRouting;providers:AIStatus[]};
// Waves describe dependencies, not fictional activity. Only approved independent read-only work overlaps.
export const PLAN_WAVES:readonly (readonly StudioRole[])[]=[['scout'],['manager'],['academy','design','network'],['dev'],['qa','shield']];
export function nextPlanningStages(p:Pick<StudioProject,'stages'>,parallel=false):Array<typeof STAGES[number]>{
  const completed=new Set(p.stages.map(s=>s.role));
  const wave=PLAN_WAVES.find(w=>w.some(r=>!completed.has(r)));
  if(!wave)return [];
  const roles=wave.filter(r=>!completed.has(r));
  return STAGES.filter(s=>roles.includes(s[0])).slice(0,parallel?roles.length:1);
}
export type StudioPreview={html:string;entry:string;portLinkAvailable:boolean};
export type StudioRuntime={available:boolean;state:'stopped'|'starting'|'running'|'stopping'|'failed';port?:number;message:string;profile?:string};
export type StudioRevision={baseId:string;rootId:string;version:number;request:string;baseBrief:string;baseDecision?:string;files:number;manifest:string[]};
export type StudioHandoff={id:string;phase:'planning'|'delivery';to:StudioRole;from:StudioRole[];at:string;state:'started'|'completed'|'failed';provider?:string;fallbackFrom?:string};
export type ProjectStage = { provider?:string; fallbackFrom?:string; role: StudioRole; text: string; sources: string[]; at: string };
export const DELIVERY_ROLES = ['dev','qa','shield'] as const;
export type DeliveryRole = typeof DELIVERY_ROLES[number];
export type DeliveryRun = { state:'running'|'failed'|'review'; steps:{role:DeliveryRole; report:string; at:string}[]; error?:string; workspace:string };
export type StudioProject = { id: string; brief: string; research: boolean; decision?: string; stages: ProjectStage[]; state: 'new'|'running'|'approval'|'ready'|'complete'|'failed'; error?: string; createdAt: string; delivery?:DeliveryRun; runningRoles?:StudioRole[]; failedRoles?:StudioRole[]; revision?:StudioRevision; handoffs?:StudioHandoff[] };
export type StudioInfo = { configured: boolean; webResearch: boolean; executionAvailable?:boolean; provider: string; routing?:RoutingInfo; projects: StudioProject[] };
