import './public-locale';
import { OfficeStore } from './net/store';
import { createUI } from './ui';
import { createWorld } from './world';
import { mountProjects } from './studio/projects';
import { mountStudioSetup } from './studio/onboarding';
import type { Member, StudioPrefs } from './studio/prefs';
import { STAGES, type StudioProject } from '../../shared/studio-project';
import { PERSONAL_AI_PREFIX } from './ui/provider';
import './public-office.css';

const models = {openai:'gpt-4.1-mini', anthropic:'claude-sonnet-4-5', gemini:'gemini-2.5-flash'};
const labels = {openai:'OpenAI', anthropic:'Claude', gemini:'Gemini'};
type Vendor = keyof typeof models;
type Connections = {connections:{provider:Vendor;model:string}[]; assignments:Record<string,Vendor>;defaultProvider:Vendor|null};
const login = document.querySelector<HTMLAnchorElement>('#login')!;
const logout = document.querySelector<HTMLButtonElement>('#logout')!;
const status = document.querySelector<HTMLElement>('#status')!;
async function request<T>(path:string,body?:unknown):Promise<T>{
  const response=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(response.status===401){login.hidden=false;if(!logout.hidden)location.replace('/public/');}
  const data=await response.json();
  if(!response.ok)throw Error(data.error || 'Falha ao acessar o estúdio.');
  return data;
}
function report(error:unknown){status.textContent=error instanceof Error?error.message:String(error);}
async function start(){
  let settings=await request<Connections>('/public/provider');
  const prefs=await request<StudioPrefs|null>('/public/preferences');
  const canvas=document.querySelector<HTMLCanvasElement>('#office-map')!;
  canvas.hidden=false;logout.hidden=false;
  logout.onclick=()=>void request('/public/logout',{}).then(()=>location.replace('https://kodexa.ia.br/login')).catch(report);
  const store=new OfficeStore();
  const world=createWorld(canvas,store);
  document.getElementById('brand')!.hidden=true;
  const ui=document.createElement('div');
  ui.id='ui';
  ui.dataset.personalOffice='true';
  document.body.append(ui);
  createUI(ui,store,world);
  const bar=ui.querySelector<HTMLElement>('.ui-topbar__right')!;
  bar.append(logout);
  const connected=document.createElement('div');
  connected.className='personal-connections';
  connected.setAttribute('aria-label','IAs conectadas nesta conta');
  bar.before(connected);
  function renderConnections(){
    connected.replaceChildren(...settings.connections.map(({provider,model})=>{
      const badge=document.createElement('span');
      badge.textContent=labels[provider];
      badge.title=model;
      return badge;
    }));
    connected.hidden=!settings.connections.length;
  }
  renderConnections();
  window.addEventListener('pagehide',()=>world.destroy(),{once:true});
  let revision=0;
  let shown:Member[]=[];
  // IA que a etapa do agente usaria na conta (mesma precedência de connectionFor no servidor, sem a equipe de um
  // projeto): a atribuição da etapa, senão a IA padrão da conta. Sem nenhuma: "none" (o chip mostra um traço).
  function aiOf(member:Member){
    const role=STAGES.find(([id])=>id===member.id)?.[0];
    const provider=(role&&settings.assignments[role])||settings.defaultProvider;
    return PERSONAL_AI_PREFIX+(provider&&settings.connections.some(c=>c.provider===provider)?provider:'none');
  }
  function showMembers(members:Member[]){
    shown=members;
    const now=Date.now();
    store.receivePersonalSnapshot({rev:++revision,serverTime:now,accounts:[],meta:{demo:false,version:'',sources:[],startedAt:now},
      rooms:members.length?[{id:'office',name:personal.prefs?.company??'Kodexa',path:'',slot:0,seed:1,createdAt:now}]:[],
      agents:members.map((m,i)=>({id:m.id,roomId:'office',name:m.name,role:m.role,kind:'main',look:i%2?'m':'f',sessionId:'',account:aiOf(m),status:'idle',seed:1+i,startedAt:now,lastEventAt:now,statusSince:now,recent:[],tasks:[],stats:{toolCalls:0,tokensIn:0,tokensOut:0,subagents:0}}))});
  }
  function select(current:string,options:string[],fallback?:string){
    const input=document.createElement('select');
    if(fallback)input.add(new Option(fallback,''));
    for(const id of options)input.add(new Option(labels[id as Vendor],id));
    input.value=current;return input;
  }
  function connections(refresh:()=>void){
    const box=document.createElement('div'), vendor=select('openai',Object.keys(models));
    vendor.setAttribute('aria-label','Provedor');
    const model=document.createElement('input'), key=document.createElement('input');
    key.type='password';key.placeholder='Chave de API';key.autocomplete='off';key.setAttribute('aria-label','Chave de API');model.setAttribute('aria-label','Modelo');
    const update=()=>{model.value=settings.connections.find(x=>x.provider===vendor.value)?.model??models[vendor.value as Vendor];key.value='';};
    vendor.onchange=update;update();
    const feedback=document.createElement('p');feedback.setAttribute('role','status');
    box.append(vendor,model,key);
    for(const disconnect of [false,true]){
      const b=document.createElement('button');b.type='button';b.textContent=disconnect?'Desconectar':'Conectar IA';
      b.onclick=async()=>{b.disabled=true;try{
        settings=await request('/public/provider',disconnect?{provider:vendor.value,disconnect:true}:{provider:vendor.value,model:model.value.trim(),key:key.value.trim()});renderConnections();showMembers(shown);refresh();
      }catch(e){feedback.textContent=(e as Error).message;}finally{b.disabled=false;}};
      box.append(b);
    }
    feedback.textContent=settings.connections.map(x=>labels[x.provider]+' · '+x.model).join(' | ');
    box.append(feedback);return box;
  }
  const personal={prefs,connections,save:async(value:StudioPrefs)=>{await request('/public/preferences',value);},
    picker:(role:string)=>{
      const input=select(settings.assignments[role]??'',settings.connections.map(x=>x.provider),'Padrão da conta');
      input.onchange=async()=>{const previous=settings.assignments[role]??'';input.disabled=true;try{
        settings=await request('/public/provider',{assign:true,role,provider:input.value||null});showMembers(shown);
      }catch(e){input.value=previous;alert((e as Error).message);}finally{input.disabled=false;}};
      return input;
    }};
  mountStudioSetup(showMembers,personal);
  mountProjects({request:async<T>(path:string,body?:unknown)=>{
    if(path==='/api/studio')return {projects:await request('/public/projects'),configured:settings.connections.length>0,webResearch:false,provider:'personal'} as T;
    return request<T>(path.replace('/api/studio/projects','/public/projects'),body);
  },team:(project:StudioProject & {team?:Record<string,Vendor>})=>{
    const box=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Equipe deste projeto';box.append(heading);
    for(const [role,name] of [['default','IA padrão do projeto'],...STAGES]){
      const field=document.createElement('label');field.textContent=name;
      const input=select(project.team?.[role]??'',settings.connections.map(x=>x.provider),'Herdar configuração');
      input.disabled=project.state==='running';
      input.onchange=async()=>{input.disabled=true;try{project.team=await request('/public/projects/'+project.id+'/team',{role,provider:input.value||null});}catch(e){input.value=project.team?.[role]??'';alert((e as Error).message);}finally{input.disabled=false;}};
      field.append(input);box.append(field);
    }return box;
  }});
}
void start().catch(report);

