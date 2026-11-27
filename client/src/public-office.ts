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

import { assignable, CHOICE_LABEL, CHOICES, DEFAULT_MODEL, GUIDE, initialChoice, LABEL, routeText, stateText, type Choice, type ProviderId, type Route, type Settings } from './studio/ai-connections';

/** Retorno do ChatGPT (?chatgpt=...): o que dizer ao voltar para o escritório. */
const CHATGPT_RETURN: Record<string, string> = {
  connected: 'ChatGPT conectado. Os agentes que usam a IA padrão da conta passam a usar o seu plano ChatGPT.',
  cancelled: 'Autorização do ChatGPT cancelada. Nada foi conectado.',
  no_permission: 'O ChatGPT identificou sua conta, mas não liberou o uso do plano para tarefas. Nada foi conectado para execução.',
  expired: 'A autorização do ChatGPT expirou ou não pertence a esta sessão. Comece de novo em Configurar estúdio.',
  pending: 'O ChatGPT ainda aguarda liberação da OpenAI para o Kodexa.',
  session: 'Sua sessão do Kodexa terminou durante a autorização. Entre de novo e reconecte o ChatGPT.',
  failed: 'A OpenAI não concluiu a autorização. Tente novamente.',
  config: 'A configuração do ChatGPT neste servidor foi recusada pela OpenAI. Avise o suporte do Kodexa.',
  busy: 'Muitas autorizações em andamento. Tente de novo em alguns minutos.',
};
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
  let settings=await request<Settings>('/public/provider');
  const returned=new URLSearchParams(location.search).get('chatgpt');
  if(returned)history.replaceState(null,'',location.pathname);
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
    const linked=settings.providers.filter(p=>p.state==='connected'||p.state==='expired'||p.state==='no_permission');
    connected.replaceChildren(...linked.map(info=>{
      const badge=document.createElement('span');
      badge.textContent=LABEL[info.provider].replace(' (chave de API)','')+(info.state==='connected'?'':' ⚠');
      badge.title=stateText(info);
      return badge;
    }));
    connected.hidden=!linked.length;
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
    if(!provider)return PERSONAL_AI_PREFIX+'none';
    const state=settings.providers.find(p=>p.provider===provider)?.state;
    return PERSONAL_AI_PREFIX+provider+(state==='connected'?'':':reconnect');
  }
  function showMembers(members:Member[]){
    shown=members;
    const now=Date.now();
    store.receivePersonalSnapshot({rev:++revision,serverTime:now,accounts:[],meta:{demo:false,version:'',sources:[],startedAt:now},
      rooms:members.length?[{id:'office',name:personal.prefs?.company??'Kodexa',path:'',slot:0,seed:1,createdAt:now}]:[],
      agents:members.map((m,i)=>({id:m.id,roomId:'office',name:m.name,role:m.role,kind:'main',look:i%2?'m':'f',sessionId:'',account:aiOf(m),status:'idle',seed:1+i,startedAt:now,lastEventAt:now,statusSince:now,recent:[],tasks:[],stats:{toolCalls:0,tokensIn:0,tokensOut:0,subagents:0}}))});
  }
  function select(current:string,options:readonly string[],fallback?:string,names:Record<string,string>=LABEL){
    const input=document.createElement('select');
    if(fallback)input.add(new Option(fallback,''));
    for(const id of options)input.add(new Option(names[id]??id,id));
    input.value=current;return input;
  }
  function el<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
  function changed(refresh:()=>void){renderConnections();showMembers(shown);refresh();}
  // Configurar estúdio › Conexões e limites das IAs.
  function connections(refresh:()=>void){
    const box=el('div');box.className='kodexa-ai';
    box.append(el('p','Escolha a IA que vai executar as tarefas dos seus agentes. O login com Google só identifica sua conta no Kodexa; cada IA tem a sua própria autorização.'));
    box.append(el('p',settings.persistent?'Suas conexões ficam guardadas com segurança no servidor do Kodexa, só para esta conta. Chaves e tokens nunca aparecem nesta página.':'Neste servidor, as conexões ficam ativas até você sair ou o serviço reiniciar. Chaves e tokens nunca aparecem nesta página.'));
    const feedback=el('p');feedback.setAttribute('role','status');
    if(returned&&CHATGPT_RETURN[returned])feedback.textContent=CHATGPT_RETURN[returned];
    let choice:Choice=initialChoice(settings);
    const chooser=select(choice,CHOICES,undefined,CHOICE_LABEL);chooser.setAttribute('aria-label','Escolha sua IA');
    const panel=el('div');panel.className='kodexa-ai__panel';
    const label=el('label','Escolha sua IA');label.append(chooser);
    chooser.onchange=()=>{choice=chooser.value as Choice;feedback.textContent='';draw();};
    async function send(body:unknown,button:HTMLButtonElement){
      button.disabled=true;
      try{settings=await request<Settings>('/public/provider',body);changed(refresh);}
      catch(e){feedback.textContent=(e as Error).message;}
      finally{button.disabled=false;}
    }
    function action(text:string,run:(b:HTMLButtonElement)=>void){const b=el('button',text);b.type='button';b.onclick=()=>run(b);return b;}
    function draw(){
      panel.replaceChildren(el('p',GUIDE[choice]));
      if(choice==='claude-code')return;
      const info=settings.providers.find(p=>p.provider===choice)!;
      const state=el('p',stateText(info));state.className='kodexa-ai__state is-'+info.state;panel.append(state);
      const buttons=el('div');buttons.className='kodexa-ai__actions';
      if(choice==='chatgpt'){
        // Sem liberação da OpenAI não há botão: nada de login que termina em erro, nem pedido de senha.
        if(info.state!=='pending_approval'&&info.state!=='connected'){
          const go=el('a',info.state==='available'?'Continuar com ChatGPT':'Reconectar ChatGPT');go.href='/public/chatgpt';go.className='kodexa-ai__link';buttons.append(go);
        }
      }else{
        const model=el('input');model.value=info.model??DEFAULT_MODEL[choice];model.setAttribute('aria-label','Modelo');model.maxLength=100;
        const key=el('input');key.type='password';key.placeholder='Cole a chave de API';key.autocomplete='off';key.setAttribute('aria-label','Chave de API');key.maxLength=512;
        panel.append(model,key);
        buttons.append(action(info.state==='available'?'Conectar':'Reconectar',b=>void send({provider:choice,model:model.value.trim(),key:key.value.trim()},b)));
      }
      if(info.state!=='available'&&info.state!=='pending_approval'){
        buttons.append(action('Desconectar',b=>{if(confirm('Desconectar '+LABEL[info.provider]+'? As escolhas de IA dos agentes continuam salvas e passam a pedir reconexão.'))void send({provider:info.provider,disconnect:true},b);}));
      }
      panel.append(buttons);
    }
    draw();
    const overview=el('ul');overview.className='kodexa-ai__overview';
    for(const info of settings.providers)overview.append(el('li',LABEL[info.provider]+': '+stateText(info).split('. ')[0].replace(/\.$/,'')));
    const usable=assignable(settings);
    const fallback=select(settings.defaultProvider??'',usable,'Nenhuma');
    fallback.onchange=async()=>{const previous=settings.defaultProvider??'';fallback.disabled=true;try{settings=await request<Settings>('/public/provider',{assign:true,role:'default',provider:fallback.value||null});changed(refresh);}catch(e){fallback.value=previous;feedback.textContent=(e as Error).message;}finally{fallback.disabled=false;}};
    const defaultField=el('label','IA padrão da conta (usada quando o agente e o projeto não escolhem outra)');defaultField.append(fallback);
    box.append(label,panel,feedback,el('h3','Suas IAs'),overview,defaultField);
    return box;
  }
  const personal={prefs,connections,save:async(value:StudioPrefs)=>{await request('/public/preferences',value);},
    picker:(role:string)=>{
      const input=select(settings.assignments[role]??'',assignable(settings),'Padrão da conta');
      input.onchange=async()=>{const previous=settings.assignments[role]??'';input.disabled=true;try{
        settings=await request<Settings>('/public/provider',{assign:true,role,provider:input.value||null});showMembers(shown);
      }catch(e){input.value=previous;alert((e as Error).message);}finally{input.disabled=false;}};
      return input;
    }};
  function personalTeam(project:StudioProject & {team?:Record<string,ProviderId>;routing?:Record<string,Route>}):HTMLElement{
    // Projetos IA: a IA efetiva de cada agente neste projeto, e a escolha que vale só para este projeto.
    // A IA efetiva de cada agente fica à vista; trocar a escolha deste projeto fica recolhido.
    const box=el('section');box.className='kodexa-ai__team';box.append(el('h4','IAs da equipe neste projeto'));
    const effective=el('ul');effective.className='kodexa-ai__routes';
    for(const [role,name] of STAGES){const route=project.routing?.[role];if(route)effective.append(el('li',routeText(name,route)));}
    const change=el('details');change.append(el('summary','Trocar a IA de um agente neste projeto'),el('p','Vale só para este projeto. Os outros projetos continuam com a escolha deles.'));
    box.append(effective,change);
    const usable=assignable(settings);
    for(const [role,name] of [['default','IA padrão deste projeto'],...STAGES] as const){
      const field=el('label',name);
      const input=select(project.team?.[role]??'',usable,'Herdar da conta');
      input.disabled=project.state==='running';
      input.onchange=async()=>{input.disabled=true;try{project.team=await request('/public/projects/'+project.id+'/team',{role,provider:input.value||null});const fresh=(await request<(StudioProject&{routing?:Record<string,Route>})[]>('/public/projects')).find(p=>p.id===project.id);project.routing=fresh?.routing;const next=personalTeam(project);(next.querySelector('details') as HTMLDetailsElement).open=true;box.replaceWith(next);}catch(e){input.value=project.team?.[role]??'';alert((e as Error).message);}finally{input.disabled=false;}};
      field.append(input);change.append(field);
    }
    if(!usable.length)change.append(el('p','Conecte uma IA em Configurar estúdio para escolher a IA de cada agente.'));
    return box;
  }
  mountStudioSetup(showMembers,personal);
  mountProjects({request:async<T>(path:string,body?:unknown)=>{
    if(path==='/api/studio'){settings=await request<Settings>('/public/provider');return {projects:await request('/public/projects'),configured:settings.providers.some(p=>p.state==='connected'),webResearch:false,provider:'personal'} as T;}
    return request<T>(path.replace('/api/studio/projects','/public/projects'),body);
  },team:personalTeam});
}
void start().catch(report);

