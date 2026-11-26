import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {runnableClaudeBin} from '../claude-bin';
import {configuredCliPlanner,executionEnvironment,type CliPlanner} from './execution';
import {AI_PROVIDERS,STAGES,type ManagedAI,type StudioAI,type StudioRole,type StudioRouting,type RoutingInfo,type AIStatus} from '../../shared/studio-project';
const IDS=['codex-cli','claude-cli','gemini'] as const;
const fresh=():StudioRouting=>({roles:Object.fromEntries(STAGES.map(s=>[s[0],'default'])) as StudioRouting['roles'],fallback:false,dailyLimit:20});
export function validateRouting(raw:unknown):StudioRouting{
 const r=raw as Partial<StudioRouting>|null;
 if(!r||typeof r.fallback!=='boolean'||typeof r.dailyLimit!=='number'||!Number.isInteger(r.dailyLimit)||r.dailyLimit<1||r.dailyLimit>1000||!r.roles||typeof r.roles!=='object')throw Error('Configuração inválida.');
 const roles=fresh().roles;
 for(const [role] of STAGES){const v=r.roles[role];if(!AI_PROVIDERS.includes(v))throw Error('Provedor inválido.');roles[role]=v;}
 return {roles,fallback:r.fallback,dailyLimit:r.dailyLimit};
}
export function claudePlanningArgs(prompt:string):string[]{
 return ['-p','--safe-mode','--tools','','--disallowedTools','*','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence','--output-format','json','--',prompt];
}
/** Claude print-mode JSON must describe a successful completed turn, not a partial/error result. */
export function claudePlanningText(out:string):string{
 const result=JSON.parse(out) as {type?:unknown;subtype?:unknown;is_error?:unknown;result?:unknown;stop_reason?:unknown}|null;
 if(result?.type!=='result'||result.subtype!=='success'||result.is_error!==false||typeof result.result!=='string'||!result.result.trim()||(result.stop_reason!=null&&result.stop_reason!=='end_turn'))throw Error('Claude não retornou texto válido.');
 return result.result;
}
type Usage={day:string;counts:Record<ManagedAI,number>};
const blankUsage=():Usage=>({day:new Date().toISOString().slice(0,10),counts:{'codex-cli':0,'claude-cli':0,gemini:0}});
export class ProviderRouter{
 private routing=fresh();
 private usage=blankUsage();
 private readonly file:string;
 private readonly codex?:CliPlanner;
 private readonly claude?:string;
 private readonly key:string;
 private readonly model:string;
 private readonly status=new Map<ManagedAI,{state:'ok'|'failed';message:string;at:string}>();
 constructor(dir:string,private readonly env:NodeJS.ProcessEnv,private readonly fetcher:typeof fetch=fetch,planner?:CliPlanner){
  this.file=join(dir,'providers.json');
  this.codex=planner??configuredCliPlanner({...env,KODEXA_STUDIO_PROVIDER:'codex-cli'});
  this.claude=runnableClaudeBin(env);
  this.key=env.GEMINI_API_KEY?.trim()||'';
  this.model=env.KODEXA_GEMINI_MODEL?.trim()||'gemini-3.8-flash';
  try{const data=JSON.parse(readFileSync(this.file,'utf8'));this.routing=validateRouting(data.routing);if(data.usage?.day===this.usage.day)for(const id of IDS){const n=data.usage.counts?.[id];if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid usage');this.usage.counts[id]=n;}}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 }
 private save(){
  const tmp=this.file+'.'+randomUUID();try{writeFileSync(tmp,JSON.stringify({routing:this.routing,usage:this.usage}),{flag:'wx',mode:0o600});renameSync(tmp,this.file);}finally{rmSync(tmp,{force:true});}
 }
 configure(raw:unknown){const next=validateRouting(raw),old=this.routing;this.routing=next;try{this.save();}catch(e){this.routing=old;throw e;}return this.info();}
 private rollover(){if(this.usage.day!==blankUsage().day)this.usage=blankUsage();}
 configured(id:ManagedAI){return id==='codex-cli'?!!this.codex:id==='claude-cli'?!!this.claude:!!this.key&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(this.model);}
 selected(role:StudioRole):StudioAI{return this.routing.roles[role];}
 fallback(){return this.routing.fallback;}
 info():RoutingInfo{
  this.rollover();
  return {routing:structuredClone(this.routing),providers:IDS.map(id=>{
   const configured=this.configured(id),s=this.status.get(id);
   return {id,configured,state:s?.state??'untested',message:s?.message??(configured?'Configurado; resposta ainda não testada.':'Não configurado.'),at:s?.at,calls:this.usage.counts[id]} satisfies AIStatus;
  })};
 }
 async call(id:ManagedAI,workspace:string,system:string,input:string):Promise<string>{
  const reject=(message:string):never=>{this.status.set(id,{state:'failed',message,at:new Date().toISOString()});throw Error(message);};
  if(!this.configured(id))reject('Provedor não configurado.');
  this.rollover();
  if(this.usage.counts[id]>=this.routing.dailyLimit)reject('Limite diário do Kodexa atingido.');
  this.usage.counts[id]++; // reserve before concurrent calls; failed attempts count too
  try{this.save();}catch{this.usage.counts[id]--;reject('Não foi possível salvar o limite de uso.');}
  try{
   let text:string;
   if(id==='codex-cli')text=await this.codex!(workspace,system+'\n'+input);
   else if(id==='claude-cli'){
    text=await new Promise<string>((ok,fail)=>{
     const env=executionEnvironment(this.env);delete env.CODEX_HOME;
     if(this.env.CLAUDE_CONFIG_DIR)env.CLAUDE_CONFIG_DIR=this.env.CLAUDE_CONFIG_DIR;
     const child=execFile(this.claude!,claudePlanningArgs(system+'\n'+input),{cwd:workspace,env,timeout:120000,killSignal:'SIGKILL',maxBuffer:1024*1024,encoding:'utf8'},(err,out)=>{
      if(err)return fail(Error('Claude não respondeu.'));
      try{ok(claudePlanningText(out));}catch{fail(Error('Claude não retornou texto válido.'));}
     });child.stdin?.end();
    });
   }else{
    const r=await this.fetcher('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(this.model)+':generateContent',{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json','x-goog-api-key':this.key},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:input}]}],generationConfig:{maxOutputTokens:4096}})});
    if(!r.ok)throw Error('Gemini HTTP '+r.status);
    const data=await r.json() as {candidates?:{finishReason?:string;content?:{parts?:{text?:string;thought?:boolean}[]}}[]};
    const candidate=data.candidates?.[0];
    if(!candidate||candidate.finishReason!=='STOP')throw Error('Gemini não concluiu a resposta.');
    text=(candidate.content?.parts??[]).filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join('\n');
   }
   if(!text.trim())throw Error('Resposta vazia.');
   this.status.set(id,{state:'ok',message:'Resposta recebida com sucesso.',at:new Date().toISOString()});
   return text.slice(0,20000);
  }catch(e){
   const message=e instanceof Error&&/^Gemini HTTP \d{3}$/.test(e.message)?e.message:'Não respondeu ou excedeu o tempo limite.';
   this.status.set(id,{state:'failed',message,at:new Date().toISOString()});
   throw Error(message);
  }
 }
}
