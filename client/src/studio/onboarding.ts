import { defaultMembers, readPrefs, savePrefs, type Member, type Provider, type StudioPrefs } from './prefs';
import { AI_PROVIDERS, STAGES, type StudioAI, type StudioRole, type StudioInfo, type StudioRouting, type RoutingInfo, type ManagedAI } from '../../../shared/studio-project';
import './onboarding.css';

const providerLabels: Record<StudioAI,string> = {default:'Padrão do servidor','codex-cli':'Codex','claude-cli':'Claude Code',gemini:'Gemini API'};
function studioRole(id: string): StudioRole | undefined { return STAGES.find(s=>s[0]===id)?.[0]; }
function localProvider(id: StudioAI): Provider { return id==='claude-cli'?'claude':id==='codex-cli'?'codex':id==='gemini'?'gemini':'unconfigured'; }
async function studioApi<T>(path:string,body?:unknown):Promise<T>{
  const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw Error(typeof data?.error==='string'?data.error:'Não foi possível acessar o estúdio.');
  return data as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text: string, action: () => void): HTMLButtonElement {
  const node = el('button',text); node.type = 'button'; node.addEventListener('click',action); return node;
}
function field(label: string, control: HTMLElement): HTMLLabelElement {
  const node = el('label'); node.append(el('span',label),control); return node;
}
function textInput(value: string, max: number): HTMLInputElement {
  const node = el('input'); node.value = value; node.maxLength = max; node.required = true; return node;
}
function select<T extends string>(options: ReadonlyArray<readonly [T,string]>, value: T, change: (v:T)=>void): HTMLSelectElement {
  const node = el('select');
  for (const [id,label] of options) { const option = el('option',label); option.value = id; node.append(option); }
  node.value = value;
  node.onchange = () => change(node.value as T);
  return node;
}
const providers: ReadonlyArray<readonly [Provider,string]> = [['unconfigured','Configurar depois'],['claude','Claude Code'],['codex','Codex'],['gemini','Gemini API']];
const themes: ReadonlyArray<readonly [StudioPrefs['theme'],string]> = [['pixel','Pixel clássico · dourado e verde'],['midnight','Meia-noite · azul e violeta'],['ocean','Oceano · azul e ciano'],['graphite','Grafite · neutro']];

export function mountStudioSetup(onMembersChanged: (members: Member[]) => void, personal?: {
  prefs: StudioPrefs | null; save: (prefs: StudioPrefs)=>Promise<void>;
  connections: (refresh: ()=>void)=>HTMLElement;
  picker: (id: StudioRole)=>HTMLSelectElement;
}): void {
  onMembersChanged((personal ? personal.prefs : readPrefs())?.members ?? []);
  if (document.getElementById('kodexa-setup-launch')) return;
  const launch = button('Configurar estúdio',open);
  launch.id = 'kodexa-setup-launch';
  const dialog = el('dialog');
  dialog.id = 'kodexa-setup';
  dialog.setAttribute('aria-label','Configuração do Kodexa AI Studio');
  document.body.append(launch,dialog);
  function open() {
    if(dialog.open)return;
    const existing = personal ? structuredClone(personal.prefs) : readPrefs();
    const draft: StudioPrefs = existing ?? {schema:1,company:'Minha empresa',theme:'pixel',members:personal ? [] : defaultMembers()};
    const title = el('h1');
    const logo = el('img'); logo.src = '/assets/brand/kodexa-logo.svg'; logo.alt = 'Kodexa AI Studio'; logo.width = 240; logo.height = 96; if(personal) title.textContent='Kodexa AI Studio'; else title.append(logo);
    const description = el('p','Configure sua empresa virtual e sua equipe. Nome e aparência ficam neste navegador; as IAs de planejamento ficam salvas no servidor e valem para os projetos.');
    if(personal) description.textContent='Configure sua empresa, sua equipe e as conexões de IA desta conta.';
    const status = el('p',''); status.setAttribute('role','status');
    const form = el('form');
    const name = textInput(draft.company,80);
    const palette = select(themes,draft.theme,v=>{draft.theme=v;dialog.dataset.theme=v;});
    dialog.dataset.theme = draft.theme;
    const modes = el('div'); modes.className = 'kodexa-modes';
    const list = el('div'); list.className = 'kodexa-members';
    const routingPanel=el('section');routingPanel.className='kodexa-routing';
    let current:RoutingInfo|undefined, routing:StudioRouting|undefined, locked=false, busy=false, routingError='Carregando configuração de IAs…';
    function rolePicker(role:StudioRole):HTMLSelectElement{
      if(personal)return personal.picker(role);
      const pick=select(AI_PROVIDERS.map(id=>[id,providerLabels[id]] as const),routing?.roles[role]??'default',v=>{if(routing)routing.roles[role]=v;});
      pick.disabled=!routing||locked||busy;return pick;
    }
    function renderRouting(){
      routingPanel.replaceChildren(el('h2','Conexões e limites das IAs'));
      if(personal){routingPanel.append(personal.connections(redraw));return;}
      if(!current||!routing){routingPanel.append(el('p',routingError));return;}
      if(locked)routingPanel.append(el('p','A equipe está trabalhando. Alterações de IA estão bloqueadas até concluir.'));
      const config=routing;
      for(const provider of current.providers){
        const row=el('p',providerLabels[provider.id]+' · '+provider.message+' · '+provider.calls+'/'+config.dailyLimit+' chamadas hoje (UTC)'+(provider.at?' · '+new Date(provider.at).toLocaleString():''));
        const test=button('Testar '+providerLabels[provider.id],()=>{
          if(confirm('Autoriza uma chamada de teste, sujeita aos limites e cobrança do provedor?'))void testProvider(provider.id);
        });test.disabled=locked||busy||!provider.configured;routingPanel.append(row,test);
      }
      const missing=STAGES.filter(([id])=>!draft.members.some(m=>m.id===id));
      if(missing.length){
        routingPanel.append(el('h2','Cargos fixos do planejamento não exibidos na equipe visual'));
        for(const [id,label] of missing)routingPanel.append(field(label+' — IA de planejamento',rolePicker(id)));
      }
      const fallback=el('input');fallback.type='checkbox';fallback.checked=config.fallback;fallback.disabled=locked||busy;fallback.onchange=()=>config.fallback=fallback.checked;
      const limit=el('input');limit.type='number';limit.min='1';limit.max='1000';limit.value=String(config.dailyLimit);limit.required=true;limit.disabled=locked||busy;limit.oninput=()=>config.dailyLimit=Number(limit.value);
      routingPanel.append(field('Autorizar Codex como alternativa se Claude/Gemini falhar',fallback),field('Limite de chamadas por IA/dia (UTC; não é limite financeiro)',limit));
    }
    async function testProvider(id:ManagedAI){
      if(busy||locked)return;
      busy=true;save.disabled=true;redraw();status.textContent='Testando '+providerLabels[id]+'…';
      try{const result=await studioApi<RoutingInfo>('/api/studio/providers/test',{id});current=result;status.textContent=result.providers.find(x=>x.id===id)?.message??'Teste concluído.';}
      catch(e){status.textContent=(e as Error).message;}
      finally{busy=false;save.disabled=false;redraw();}
    }
    async function loadRouting(){
      try{const info=await studioApi<StudioInfo>('/api/studio');current=info.routing;routing=current?structuredClone(current.routing):undefined;locked=info.projects.some(x=>x.state==='running'||x.delivery?.state==='running');routingError='Roteamento indisponível no servidor.';}
      catch(e){routingError=(e as Error).message;}
      redraw();
    }
    const redraw = () => {
      list.replaceChildren();
      for (const member of draft.members) {
        const row = el('fieldset');
        row.append(el('legend',member.role));
        const n = textInput(member.name,80); n.oninput=()=>{member.name=n.value;};
        const r = textInput(member.role,120); r.oninput=()=>{member.role=r.value;};
        const role=studioRole(member.id);
        const providerField=role?field('IA de planejamento',rolePicker(role)):field('IA pretendida (somente visual)',select(providers,member.provider,v=>{member.provider=v;}));
        row.append(field('Nome',n),field('Cargo',r),providerField,button('Remover',()=>{draft.members=draft.members.filter(x=>x.id!==member.id);redraw();}));
        list.append(row);
      }
      if (!draft.members.length) list.append(el('p','Escritório vazio. Adicione um agente quando quiser.'));
      add.disabled = draft.members.length >= 32;
      renderRouting();
    };
    const add = button('Adicionar agente',()=>{
      if(draft.members.length>=32)return;
      const member:Member={id:crypto.randomUUID?.() ?? ('local-'+Date.now()+'-'+Math.random().toString(36).slice(2)),name:'Novo agente',role:'Especialista',provider:'unconfigured'};
      draft.members.push(member);redraw();
    });
    modes.append(button('Equipe padrão (8)',()=>{draft.members=defaultMembers();redraw();}),button('Escritório vazio',()=>{draft.members=[];redraw();}));
    const note = el('p','Os oito cargos fixos usam a seleção de IA para planejamento de todos os projetos. Agentes personalizados são apenas visuais. Escolher uma IA não conecta uma conta nem concede permissões de execução. A construção e os testes executáveis continuam no Codex. Configure GEMINI_API_KEY no servidor. A formação do Academy continua separada.');
    if(personal) note.textContent='As atribuições de cada projeto ficam em Projetos IA.';
    note.className='kodexa-note';
    const save = el('button','Salvar configuração'); save.type='submit';save.className='kodexa-primary';
    const close = button('Fechar',()=>dialog.close());
    const actions = el('div');actions.className='kodexa-actions';actions.append(close,save);
    form.append(field('Nome da empresa',name),field('Tema da configuração',palette),el('h2','Equipe inicial'),modes,list,add,routingPanel,note,status,actions);
    form.onsubmit=e=>{
      e.preventDefault();if(busy)return;void saveAll();
    };
    async function saveAll(){
      draft.company=name.value.trim();
      draft.members=draft.members.map(m=>({...m,name:m.name.trim(),role:m.role.trim()}));
      if(routing&&current&&JSON.stringify(routing)!==JSON.stringify(current.routing)){
        if(locked){status.textContent='Aguarde a equipe antes de alterar as IAs.';return;}
        if(!Number.isInteger(routing.dailyLimit)||routing.dailyLimit<1||routing.dailyLimit>1000){status.textContent='Informe um limite entre 1 e 1000.';return;}
        if(!confirm('Autoriza enviar briefing e relatórios aos provedores escolhidos, inclusive ao Codex se fallback estiver marcado? As cotas e cobranças são de cada conta.'))return;
        busy=true;save.disabled=true;status.textContent='Salvando IAs…';redraw();
        try{current=await studioApi<RoutingInfo>('/api/studio/providers',routing);routing=structuredClone(current.routing);}
        catch(e){status.textContent=(e as Error).message;return;}
        finally{busy=false;save.disabled=false;redraw();}
      }
      if(routing)for(const m of draft.members){const role=studioRole(m.id);if(role)m.provider=localProvider(routing.roles[role]);}
      if(personal){
        try{save.disabled=true;await personal.save(draft);personal.prefs=structuredClone(draft);}
        catch(e){status.textContent=(e as Error).message;return;}
        finally{save.disabled=false;}
      } else if(!savePrefs(draft)){status.textContent='Não foi possível salvar as preferências do navegador. A configuração de IAs do servidor não foi revertida.';return;}
      onMembersChanged(draft.members);
      dialog.close();
    }
    dialog.replaceChildren(title,description,form);redraw();dialog.showModal();if(!personal)void loadRouting();
  }
  if (!personal && !readPrefs()) open();
}
