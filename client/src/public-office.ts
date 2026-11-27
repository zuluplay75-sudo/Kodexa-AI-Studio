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

import { assignable, CHOICE_LABEL, CHOICES, connectorCommands, platformOf, DEFAULT_MODEL, GUIDE, initialChoice, LABEL, LOCAL, routeText, stateText, type Choice, type Device, type ProviderId, type Route, type Settings } from './studio/ai-connections';

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
// "Autorizar este computador" (Kodexa Conector): o link chega com ?conectar=<pedido>. Guarda na aba antes do login
// com Google (que volta para /public/ sem o parâmetro) e tira da barra de endereço.
const CONNECT_KEY='kodexa.conectar';
{
  const pending=new URLSearchParams(location.search).get('conectar');
  if(pending&&/^[A-Za-z0-9_-]{32}$/.test(pending)){try{sessionStorage.setItem(CONNECT_KEY,pending);}catch{/* aba sem storage: segue só nesta visita */}
    const url=new URL(location.href);url.searchParams.delete('conectar');history.replaceState(null,'',url.pathname+url.search);(globalThis as {kodexaConnect?:string}).kodexaConnect=pending;}
}
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
      const info=settings.providers.find(p=>p.provider===choice)!;
      if(LOCAL.includes(choice)){
        // Como o Habblaud original: a IA roda no computador do cliente. Aqui só se pareia e se acompanha o computador.
        const state=el('p',stateText(info));state.className='kodexa-ai__state is-'+info.state;panel.append(state);
        const devices=el('ul');devices.className='kodexa-ai__devices';
        const pairing=el('div');pairing.className='kodexa-ai__pairing';
        const renderDevices=(list:Device[])=>{
          devices.replaceChildren(...list.map(d=>{
            const li=el('li',d.name+' · '+(d.online?'ligado'+(d.tools.codex?' · Codex':'')+(d.tools.claude?' · Claude Code':''):'desligado')+' ');
            li.append(action('Remover',b=>{if(confirm('Remover '+d.name+'? O conector desse computador deixa de funcionar até ser pareado de novo.'))void (async()=>{b.disabled=true;try{renderDevices((await request<{devices:Device[]}>('/public/connector/revoke',{id:d.id})).devices);settings=await request<Settings>('/public/provider');changed(refresh);}catch(e){feedback.textContent=(e as Error).message;}finally{b.disabled=false;}})();}));
            return li;
          }));
          if(!list.length)devices.append(el('li','Nenhum computador pareado ainda.'));
        };
        const store=el('div');
        const loadDevices=()=>request<{devices:Device[];storeUrl:string|null}>('/public/connector').then(r=>{renderDevices(r.devices);
          // Publicado na Microsoft Store: no Windows, instalar pela loja é o caminho principal (assinado, sem aviso).
          if(r.storeUrl&&platform==='windows'&&tool==='codex'&&!store.childElementCount){const a=el('a','Instalar pela Microsoft Store');a.href=r.storeUrl;a.target='_blank';a.rel='noopener noreferrer';a.className='kodexa-ai__link';
            store.append(a,el('p','Depois de instalar, abra o Kodexa Conector: ele mostra um código e abre o navegador para você autorizar este computador.'));}
        }).catch(e=>feedback.textContent=(e as Error).message);
        // Enquanto o diálogo está aberto, a lista acompanha o conector ligando (depois do instalador ou dos comandos).
        const timer=setInterval(()=>{if(!panel.isConnected)clearInterval(timer);else void loadDevices();},5000);
        const platform=platformOf(navigator.userAgent,(navigator as Navigator&{userAgentData?:{platform?:string}}).userAgentData?.platform);
        const tool=choice==='claude-local'?'claude':'codex';
        void loadDevices();
        const generate=action(platform==='windows'&&tool==='codex'?'Prefiro usar comandos no terminal':'Gerar código de pareamento',b=>void (async()=>{b.disabled=true;try{
          const r=await request<{code:string;expiresAt:number;server:string}>('/public/connector/pair',{});
          pairing.replaceChildren(el('p','Código: '+r.code+' (vale por 10 minutos, uma vez). Com o Node.js instalado, rode no terminal do seu computador:'));
          for(const option of connectorCommands(r.server,r.code,tool,platform))pairing.append(el('h5',option.terminal),el('pre',option.lines.join('\n')));
          pairing.append(el('p','Deixe a janela do conector aberta. Quando ele estiver ligado, este painel mostra o computador como ligado.'));
        }catch(e){feedback.textContent=(e as Error).message;}finally{b.disabled=false;}})());
        panel.append(el('h4','Seus computadores'),devices,store);
        if(platform==='windows'&&tool==='codex'){
          // Windows: um instalador com o código dentro (dois cliques), que instala o que faltar e pareia.
          const installer=el('a','Baixar instalador para Windows');installer.href='/public/connector/windows.cmd';installer.className='kodexa-ai__link';installer.setAttribute('download','Instalar Kodexa Conector.cmd');
          panel.append(installer,el('p','Abra o arquivo baixado com dois cliques. Ele confere o Node.js, instala o Codex se faltar, pede o login do ChatGPT e conecta este computador. Se o Windows perguntar se deseja executar, confirme. O código de dentro vale por 10 minutos.'));
        }
        panel.append(generate,pairing);
        return;
      }
      const state=el('p',stateText(info));state.className='kodexa-ai__state is-'+info.state;panel.append(state);
      const buttons=el('div');buttons.className='kodexa-ai__actions';
      if(choice==='chatgpt'){
        // Sem liberação da OpenAI não há botão: nada de login que termina em erro, nem pedido de senha.
        if(info.state!=='pending_approval'&&info.state!=='connected'){
          const go=el('a',info.state==='available'?'Continuar com ChatGPT':'Reconectar ChatGPT');go.href='/public/chatgpt';go.className='kodexa-ai__link';buttons.append(go);
        }
      }else{
        const model=el('input');model.value=info.model??DEFAULT_MODEL[choice as keyof typeof DEFAULT_MODEL];model.setAttribute('aria-label','Modelo');model.maxLength=100;
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
  void confirmComputer();
  async function confirmComputer(){
    let id:string|null=(globalThis as {kodexaConnect?:string}).kodexaConnect??null;
    try{id??=sessionStorage.getItem(CONNECT_KEY);sessionStorage.removeItem(CONNECT_KEY);}catch{/* sem storage */}
    if(!id)return;
    const dialog=el('dialog');dialog.id='kodexa-authorize';dialog.className='kodexa-authorize';document.body.append(dialog);
    const close=el('button','Cancelar');close.type='button';close.onclick=()=>dialog.close();
    try{
      const {request:r}=await request<{request:{name:string;userCode:string;tools:{codex:boolean;claude:boolean}}}>('/public/connector?request='+encodeURIComponent(id));
      const tools=[r.tools.codex&&'Codex',r.tools.claude&&'Claude Code'].filter(Boolean).join(' e ')||'nenhuma ferramenta';
      const code=el('p','Código: '+r.userCode);code.className='kodexa-authorize__code';
      const ok=el('button','Autorizar este computador');ok.type='button';ok.className='kodexa-primary';
      const status=el('p');status.setAttribute('role','status');
      ok.onclick=async()=>{ok.disabled=true;try{await request('/public/connector/approve',{id});settings=await request<Settings>('/public/provider');changed(()=>{});
        dialog.replaceChildren(el('h2','Computador autorizado'),el('p',r.name+' agora executa as tarefas dos seus agentes com o '+tools+' dele. Pode voltar à janela do Kodexa Conector.'),close);close.textContent='Fechar';}
        catch(e){status.textContent=(e as Error).message;ok.disabled=false;}};
      dialog.append(el('h2','Autorizar este computador?'),
        el('p','O computador "'+r.name+'" pediu para executar as tarefas dos agentes desta conta, usando o '+tools+' instalado nele.'),
        code,el('p','Confira se é o mesmo código mostrado na janela do Kodexa Conector. Só autorize se foi você que abriu o conector agora, no seu computador. Você pode remover o computador depois em Configurar estúdio.'),
        status,ok,close);
    }catch(e){dialog.append(el('h2','Autorizar este computador'),el('p',(e as Error).message),close);}
    dialog.showModal();
  }
  mountProjects({request:async<T>(path:string,body?:unknown)=>{
    if(path==='/api/studio'){settings=await request<Settings>('/public/provider');return {projects:await request('/public/projects'),configured:settings.providers.some(p=>p.state==='connected'),webResearch:false,provider:'personal'} as T;}
    return request<T>(path.replace('/api/studio/projects','/public/projects'),body);
  },team:personalTeam});
}
void start().catch(report);

