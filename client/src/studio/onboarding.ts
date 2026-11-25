import { defaultMembers, readPrefs, savePrefs, type Member, type Provider, type StudioPrefs } from './prefs';
import './onboarding.css';

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
const providers: ReadonlyArray<readonly [Provider,string]> = [['unconfigured','Configurar depois'],['claude','Claude Code'],['codex','Codex']];
const themes: ReadonlyArray<readonly [StudioPrefs['theme'],string]> = [['pixel','Pixel clássico · dourado e verde'],['midnight','Meia-noite · azul e violeta'],['ocean','Oceano · azul e ciano'],['graphite','Grafite · neutro']];

export function mountStudioSetup(): void {
  if (document.getElementById('kodexa-setup-launch')) return;
  const launch = button('Configurar estúdio',open);
  launch.id = 'kodexa-setup-launch';
  const dialog = el('dialog');
  dialog.id = 'kodexa-setup';
  dialog.setAttribute('aria-label','Configuração do Kodexa AI Studio');
  document.body.append(launch,dialog);
  function open() {
    const existing = readPrefs();
    const draft: StudioPrefs = existing ?? {schema:1,company:'Minha empresa',theme:'pixel',members:defaultMembers()};
    const title = el('h1');
    const logo = el('img'); logo.src = '/assets/brand/kodexa-logo.svg'; logo.alt = 'Kodexa AI Studio'; logo.width = 240; logo.height = 96; title.append(logo);
    const description = el('p','Configure sua empresa virtual e escolha os cargos iniciais. Estas preferências ficam neste navegador.');
    const status = el('p',''); status.setAttribute('role','status');
    const form = el('form');
    const name = textInput(draft.company,80);
    const palette = select(themes,draft.theme,v=>{draft.theme=v;dialog.dataset.theme=v;});
    dialog.dataset.theme = draft.theme;
    const modes = el('div'); modes.className = 'kodexa-modes';
    const list = el('div'); list.className = 'kodexa-members';
    const redraw = () => {
      list.replaceChildren();
      for (const member of draft.members) {
        const row = el('fieldset');
        row.append(el('legend',member.role));
        const n = textInput(member.name,80); n.oninput=()=>{member.name=n.value;};
        const r = textInput(member.role,120); r.oninput=()=>{member.role=r.value;};
        row.append(field('Nome',n),field('Cargo',r),field('IA pretendida',select(providers,member.provider,v=>{member.provider=v;})),button('Remover',()=>{draft.members=draft.members.filter(x=>x.id!==member.id);redraw();}));
        list.append(row);
      }
      if (!draft.members.length) list.append(el('p','Escritório vazio. Adicione um agente quando quiser.'));
      add.disabled = draft.members.length >= 32;
    };
    const add = button('Adicionar agente',()=>{
      if(draft.members.length>=32)return;
      const member:Member={id:crypto.randomUUID?.() ?? ('local-'+Date.now()+'-'+Math.random().toString(36).slice(2)),name:'Novo agente',role:'Especialista',provider:'unconfigured'};
      draft.members.push(member);redraw();
    });
    modes.append(button('Equipe padrão (8)',()=>{draft.members=defaultMembers();redraw();}),button('Escritório vazio',()=>{draft.members=[];redraw();}));
    const note = el('p','Escolher uma IA aqui não conecta uma conta, inicia uma sessão ou concede permissões. A formação do Academy é configurada separadamente no servidor.');
    note.className='kodexa-note';
    const save = el('button','Salvar configuração'); save.type='submit';save.className='kodexa-primary';
    const close = button('Fechar',()=>dialog.close());
    const actions = el('div');actions.className='kodexa-actions';actions.append(close,save);
    form.append(field('Nome da empresa',name),field('Tema da configuração',palette),el('h2','Equipe inicial'),modes,list,add,note,status,actions);
    form.onsubmit=e=>{
      e.preventDefault(); draft.company=name.value.trim();
      draft.members=draft.members.map(m=>({...m,name:m.name.trim(),role:m.role.trim()}));
      if(!savePrefs(draft)){status.textContent='Não foi possível salvar. Confira os campos e o armazenamento do navegador.';return;}
      dialog.close();
    };
    dialog.replaceChildren(title,description,form);redraw();dialog.showModal();
  }
  if (!readPrefs()) open();
}
