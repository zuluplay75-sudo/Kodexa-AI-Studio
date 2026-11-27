import { STAGES, nextPlanningStages, type StudioInfo, type StudioProject } from '../../../shared/studio-project';
import './projects.css';
import { openAcademy } from './academy';
import { openProjectPreview } from './preview';
function el<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string):HTMLElementTagNameMap[K]{
  const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;
}
function btn(text:string,action:()=>void){const b=el('button',text);b.type='button';b.onclick=action;return b;}
async function api<T>(path:string,body?:unknown):Promise<T>{
  const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(typeof data?.error==='string'?data.error:'Não foi possível acessar o estúdio.');
  return data as T;
}
export function mountProjects(personal?: { request: typeof api; team: (project: StudioProject)=>HTMLElement }){
  const request = personal?.request ?? api;
  if(document.getElementById('kodexa-projects-launch'))return;
  const dialog=el('dialog');dialog.id='kodexa-projects';dialog.setAttribute('aria-label','Projetos Kodexa');
  const launch=btn('Projetos IA',()=>{dialog.showModal();void refresh();});launch.id='kodexa-projects-launch';
  document.body.append(launch,dialog);
  let poll:ReturnType<typeof setInterval>|undefined;
  launch.addEventListener('click',()=>{if(!poll)poll=setInterval(()=>{if(!busy && info?.projects.some(p=>p.state==='running'||p.delivery?.state==='running'))void refresh();},2500);});
  dialog.addEventListener('close',()=>{if(poll)clearInterval(poll);poll=undefined;});
  let selected='',busy=false,info:StudioInfo|undefined;
  let view:'list'|'create'|'project'='list';
  const heading=el('h2','Projetos Kodexa'),content=el('div'),status=el('p');status.setAttribute('role','status');
  const close=btn('Fechar',()=>dialog.close());const toolbar=el('header');toolbar.className='kodexa-projects-toolbar';toolbar.append(heading,close);
  dialog.append(toolbar,status,content);
  async function refresh(){
    try{info=await request<StudioInfo>('/api/studio');status.textContent='';render();}
    catch(e){status.textContent=(e as Error).message;}
  }
  async function action(fn:()=>Promise<unknown>){
    if(busy)return;busy=true;render();status.textContent='Processando…';
    try{await fn();await refresh();}catch(e){status.textContent=(e as Error).message;}
    finally{busy=false;render();}
  }
  function render(){
    if(!info)return;
    content.replaceChildren();
    if(view==='list'){
      const actions=el('div');actions.className='kodexa-projects-actions';
      actions.append(btn('Novo projeto',()=>{view='create';render();}));
      if(!personal) actions.append(btn('Abrir Academy',openAcademy));
      content.append(actions);
      const groups=new Map<string,StudioProject>();
      for(const project of info.projects){
        const root=project.revision?.rootId??project.id;
        const previous=groups.get(root);
        if(!previous||(project.revision?.version??1)>(previous.revision?.version??1))groups.set(root,project);
      }
      if(!groups.size)content.append(el('p','Você ainda não tem projetos.'));
      const list=el('ul');list.className='kodexa-projects-list';
      for(const project of groups.values()){
        const row=el('li');
        const root=info.projects.find(item=>item.id===(project.revision?.rootId??project.id))??project;
        const open=btn(root.brief.slice(0,100),()=>{selected=project.id;view='project';render();});
        open.className='kodexa-projects-row';
        const state=project.delivery?.state==='review'?'Pronto para revisão':
          project.state==='running'||project.delivery?.state==='running'?'Em execução':
          project.state==='approval'?'Aguardando aprovação':
          project.error||project.delivery?.error?'Requer atenção':
          project.state==='complete'?'Planejamento concluído':'Em planejamento';
        open.append(el('small','Versão '+(project.revision?.version??1)+' · '+state));
        row.append(open);list.append(row);
      }
      content.append(list);
      return;
    }
    const back=btn('Voltar aos projetos',()=>{view='list';render();});back.disabled=busy;content.append(back);
    const p=info.projects.find(x=>x.id===selected);
    if(view==='create'||!p){
      content.append(el('h3','Novo projeto'));
      const brief=el('textarea');brief.placeholder='Que aplicativo, jogo ou sistema você deseja criar? Se estiver em dúvida, diga seu público ou interesses.';brief.maxLength=4000;brief.rows=5;
      const label=el('label','Pesquisa real na web pelo Scout '),research=el('input');research.type='checkbox';research.disabled=!info.webResearch||busy;label.append(research);
      const create=btn('Criar projeto',()=>void action(async()=>{const x=await request<StudioProject>('/api/studio/projects',{brief:brief.value,research:research.checked});selected=x.id;view='project';}));create.disabled=busy;
      content.append(brief,label,create);return;
    }
    content.append(el('h3',p.brief),el('p','Etapas de planejamento concluídas: '+p.stages.length+' de '+STAGES.length));
    if(personal) content.append(personal.team(p));
    if(p.revision){content.append(el('p','Versão '+p.revision.version+' · '+p.revision.files+' arquivos de origem copiados · '+p.revision.baseBrief));const previous=btn('Abrir versão de origem',()=>{selected=p.revision!.baseId;render();});previous.disabled=busy;content.append(previous);}
    const rootId=p.revision?.rootId??p.id;
    const versions=info.projects.filter(x=>x.id===rootId||x.revision?.rootId===rootId).sort((a,b)=>(a.revision?.version??1)-(b.revision?.version??1));
    if(versions.length>1){const history=el('details');history.append(el('summary','Histórico de versões ('+versions.length+')'));for(const v of versions){const b=btn('V'+(v.revision?.version??1)+' — '+v.brief.slice(0,90)+(v.id===p.id?' (atual)':''),()=>{selected=v.id;render();});b.disabled=busy||v.id===p.id;history.append(b);}content.append(history);}
    if(p.delivery?.state==='review'){const improve=el('details');improve.append(el('summary','Melhorar esta versão'));const change=el('textarea');change.placeholder='Descreva melhorias ou correções desta versão…';change.maxLength=4000;change.rows=3;const revise=btn('Evoluir este projeto',()=>{const request=change.value.trim();if(request.length<10){status.textContent='Descreva a alteração com pelo menos 10 caracteres.';return;}if(confirm('Criar uma nova versão com cópia dos arquivos de código? A versão original será preservada. Revise os arquivos antes de prosseguir; dados e segredos conhecidos são excluídos.'))void action(async()=>{const next=await api<StudioProject>('/api/studio/projects/'+p.id+'/revise',{request,approved:true});selected=next.id;});});revise.disabled=busy||info.projects.some(x=>x.state==='running'||x.delivery?.state==='running');improve.append(change,revise);content.append(improve);}
    const planning=el('details');planning.append(el('summary','Planejamento e atividade da equipe'));
    if(p.handoffs?.length){const h=el('details');h.append(el('summary','Comunicação da equipe ('+p.handoffs.length+' repasses)'));for(const item of [...p.handoffs].reverse()){const name=(r:string)=>STAGES.find(s=>s[0]===r)?.[1]??r;const from=item.from.length?item.from.map(name).join(', '):'Briefing do diretor';h.append(el('p',from+' → '+name(item.to)+' · '+(item.phase==='delivery'?'execução':'planejamento')+(item.provider?' · '+item.provider:'')+(item.fallbackFrom?' (alternativa de '+item.fallbackFrom+')':'')+' · '+({started:'em execução',completed:'concluído',failed:'interrompido'}[item.state])));}planning.append(h);}
    if(p.runningRoles?.length)content.append(el('p','Trabalhando agora: '+p.runningRoles.map(r=>STAGES.find(s=>s[0]===r)?.[1]??r).join(' · ')));
    for(const s of p.stages){
      const details=el('details');details.open=s===p.stages.at(-1);details.append(el('summary',(STAGES.find(x=>x[0]===s.role)?.[1]??s.role)+(s.provider?' · '+s.provider:'')+(s.fallbackFrom?' (alternativa de '+s.fallbackFrom+')':'')),el('pre',s.text));
      for(const url of s.sources){const a=el('a',url);a.href=url;a.target='_blank';a.rel='noopener noreferrer';details.append(a);}
      planning.append(details);
    }
    if(p.stages.length||p.handoffs?.length)content.append(planning);
    if(!info.configured&&p.state!=='complete')content.append(el('p','Configure um provedor de IA para executar o planejamento.'));
    if(p.error)content.append(el('p',p.error));
    const base='/api/studio/projects/'+p.id;
    if(p.state==='approval'){
      const decision=el('textarea');decision.placeholder='Escolha uma opção do Scout ou descreva sua decisão.';decision.maxLength=4000;
      const approve=btn('Aprovar e liberar Manager',()=>void action(()=>request(base+'/approve',{decision:decision.value})));approve.disabled=busy;content.append(decision,approve);
    }else if(['new','ready','failed'].includes(p.state)){
      const next=btn('Executar '+(nextPlanningStages(p)[0]?.[1]??'etapa'),()=>void action(()=>request(base+'/next',{})));next.disabled=busy||!info.configured||info.projects.some(x=>x.state==='running'||x.delivery?.state==='running');content.append(next);
      if(p.decision && !personal){const remaining=STAGES.length-p.stages.length;const all=btn('Executar equipe restante em paralelo ('+remaining+' chamadas)',()=>{if(confirm('Autoriza '+remaining+' etapas de IA (até duas chamadas por etapa se a alternativa estiver autorizada), sujeitas à cobrança das contas?'))void action(()=>api(base+'/next',{all:true}));});all.disabled=next.disabled;content.append(all);}
    }else if(p.state==='running'){const update=btn('Atualizar estado',()=>void refresh());update.disabled=busy;content.append(update);}
    else if(p.state==='complete'){
      content.append(el('p','Planejamento concluído. A execução de código exige autorização separada.'));
      if(personal)return;
      if(p.delivery){
        const reports=el('details');reports.append(el('summary','Arquivos e relatórios das sessões'),el('p',p.delivery.workspace));
        for(const step of p.delivery.steps){const d=el('details');d.append(el('summary',step.role+' — relatório da sessão'),el('pre',step.report));reports.append(d);}
        content.append(reports);
        if(p.delivery.error)content.append(el('p',p.delivery.error));
        if(p.delivery.state==='review')content.append(el('p','Sessões concluídas. Revise os arquivos e os relatórios antes de publicar. O término da sessão não comprova que todos os testes passaram.'));
        if(p.delivery.state==='running'){content.append(el('p','Equipe executando o projeto no servidor.'));return;}
        if(p.delivery.state==='review')content.append(btn('Visualizar aplicativo',()=>openProjectPreview(p)));
        const zip=el('a','Baixar ZIP dos arquivos gerados');zip.href=base+'/archive';zip.download='kodexa-'+p.id+'.zip';content.append(zip,el('p','Exportação de até 20 MB/2000 arquivos. Revise o conteúdo antes de compartilhar.'));
      }
      if(p.delivery?.state!=='review'){
        const execute=btn(p.delivery?'Retomar execução Codex':'Construir projeto com Codex',()=>{
          if(confirm('Autoriza sessões reais de programação, testes e revisão em uma pasta nova gerenciada pelo Kodexa? Isso usa a cota do Codex.'))void action(()=>api(base+'/deliver',{approved:true}));
        });
        execute.disabled=busy||!info.executionAvailable||info.projects.some(x=>x.state==='running'||x.delivery?.state==='running');
        content.append(execute);
        if(!info.executionAvailable)content.append(el('p','Executor Codex desabilitado. Configure uma conta dedicada e KODEXA_EXEC_ENABLED no servidor.'));
      }
      const folder=el('input');folder.placeholder='/workspaces/meu-projeto';folder.setAttribute('aria-label','Pasta absoluta do projeto');
      const handoff=btn('Iniciar sessão Claude Code',()=>void action(async()=>{
        const prompt=('Implemente o projeto conforme a decisão aprovada: '+p.decision+'\n'+p.stages.filter(s=>['manager','dev','qa','shield'].includes(s.role)).map(s=>s.role+': '+s.text.slice(0,1300)).join('\n')).slice(0,8000);
        const r=await api<{id:string}>('/api/spawn',{folder:folder.value,prompt});
        status.textContent='Solicitação enviada: '+r.id+'. Confira o estado no escritório.';
        for(let i=0;i<45;i++){await new Promise(resolve=>setTimeout(resolve,2000));const s=await api<{status:string;error?:string;how?:string}>('/api/spawn/'+encodeURIComponent(r.id));if(s.status==='opened'){alert(s.how==='cli'?'Sessão iniciada. Acompanhe no escritório.':'Aplicativo aberto; ainda precisa iniciar a sessão.');return;}if(s.status==='failed')throw new Error(s.error||'Falha ao iniciar sessão.');}
        throw new Error('A abertura não foi confirmada.');
      }));handoff.disabled=busy;const advanced=el('details');advanced.append(el('summary','Sessão Claude Code'),folder,handoff);content.append(advanced);
    }
  }
}
