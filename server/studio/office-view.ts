import {STAGES,DELIVERY_ROLES,nextPlanningStages,type StudioInfo,type StudioRole,type StudioProject} from '../../shared/studio-project';
import type {AgentInfo,ActivityKind} from '../../shared/types';
import {hash32} from '../../shared/hash';
export const STUDIO_ROOM='kodexa:studio',STUDIO_ACCOUNT='kodexa:managed';
type State=NonNullable<AgentInfo['managed']>['state'];
type Phase=NonNullable<AgentInfo['managed']>['phase'];
function stage(p:StudioProject|undefined,role:StudioRole):{phase:Phase;state:State;text:string;kind:ActivityKind;icon:string}{
  const d=p?.delivery,plan=p?.stages.find(s=>s.role===role);
  if(d&&DELIVERY_ROLES.some(r=>r===role)){
    if(d.steps.some(s=>s.role===role))return {phase:'delivery',state:'completed',text:'Sessão concluída; revise o relatório',kind:'done',icon:'✓'};
    if(DELIVERY_ROLES[d.steps.length]===role){
      if(d.state==='running')return {phase:'delivery',state:'working',text:role==='dev'?'Implementação em execução':role==='qa'?'Sessão de testes em execução':'Revisão de segurança em execução',kind:'think',icon:'⚙️'};
      if(d.state==='failed')return {phase:'delivery',state:'failed',text:'Sessão interrompida',kind:'error',icon:'⚠️'};
    }
    return {phase:'delivery',state:'pending',text:'Aguardando etapa de execução',kind:'wait',icon:'⏳'};
  }
  if(role==='scout'&&p?.state==='approval')return {phase:'planning',state:'waiting',text:'Aguardando aprovação em Projetos IA',kind:'ask',icon:'✋'};
  if(plan)return {phase:'planning',state:'completed',text:'Planejamento concluído',kind:'done',icon:'✓'};
  if(p){
    if(p.failedRoles?.includes(role))return {phase:'planning',state:'failed',text:'Planejamento interrompido',kind:'error',icon:'⚠️'};
    const next=nextPlanningStages(p).some(s=>s[0]===role);
    if(p.state==='running'&&(p.runningRoles?p.runningRoles.includes(role):next))return {phase:'planning',state:'working',text:'Planejamento em execução',kind:'plan',icon:'📝'};
    if(p.state==='failed'&&!p.failedRoles&&next)return {phase:'planning',state:'failed',text:'Planejamento interrompido',kind:'error',icon:'⚠️'};
  }
  return {phase:'planning',state:'pending',text:p?'Aguardando sua etapa':'Disponível para novo projeto',kind:'wait',icon:'☕'};
}
export function studioRoster(info:StudioInfo,now:number):AgentInfo[]{
  const p=info.projects.find(x=>x.state==='running'||x.delivery?.state==='running')??info.projects[0];
  return STAGES.map(([role,name],i)=>{
    const c=stage(p,role),id='kodexa:role:'+role;
    const handoff=p?.handoffs?.filter(h=>h.to===role&&h.phase===c.phase).at(-1);
    const ai=c.phase==='delivery'?'codex-cli':handoff?.provider??p?.stages.find(s=>s.role===role)?.provider??info.routing?.routing.roles[role]??info.provider;
    const providerName=ai==='default'?info.provider:ai;
    const detail=(handoff?.from.length?'Contexto recebido de: '+handoff.from.map(r=>STAGES.find(s=>s[0]===r)?.[1]??r).join(', ')+' · ':'')+'IA: '+providerName+(handoff?.fallbackFrom?' (alternativa de '+handoff.fallbackFrom+')':'');
    return {id,kind:'main',provider:providerName==='anthropic'||providerName==='claude-cli'?'claude':'codex',roomId:STUDIO_ROOM,name,look:i%2?'f':'m',role:name,title:c.text+' · '+providerName,sessionId:id,account:STUDIO_ACCOUNT,status:c.state==='working'?'working':c.state==='waiting'?'waiting':'idle',waitingFor:c.state==='waiting'?'Aprovar em Projetos IA':undefined,managed:{role,projectId:p?.id,phase:c.phase,state:c.state,ai:providerName},activity:{id:id+':'+now,kind:c.kind,icon:c.icon,text:c.text,detail,at:now,error:c.state==='failed'||undefined},recent:[],tasks:[{id:id+':task',title:c.phase==='delivery'?'Execução':'Planejamento',status:c.state==='completed'?'completed':c.state==='working'?'in_progress':'pending'}],startedAt:p?Date.parse(p.createdAt)||now:now,lastEventAt:now,statusSince:now,stats:{toolCalls:0,tokensIn:0,tokensOut:0,subagents:0},seed:hash32(id)};
  });
}
