import type {StudioProject,StudioPreview,StudioRuntime} from '../../../shared/studio-project';
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string):HTMLElementTagNameMap[K]{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;}
function button(label:string,fn:()=>void){const b=node('button',label);b.type='button';b.onclick=fn;return b;}
export function privatePortUrl(origin:string,port:number):string|undefined{
  if(!Number.isInteger(port)||port<1024||port>65535||[4747,4748].includes(port))return undefined;
  try{
    const u=new URL(origin);
    if(u.protocol!=='https:'||!/^([a-z0-9-]+)-4748\.app\.github\.dev$/.test(u.hostname)||u.port||u.username||u.password)return undefined;
    u.hostname=u.hostname.replace(/-4748\.app\.github\.dev$/,'-'+port+'.app.github.dev');u.pathname='/';u.search='';u.hash='';return u.origin+'/';
  }catch{return undefined;}
}
export function previewDocument(html:string,scripts:boolean):string{
  const policy="default-src 'none'; script-src "+(scripts?"'unsafe-inline' data:":"'none'")+"; style-src 'unsafe-inline' data:; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'; media-src data:";
  // Prepend the policy before any generated markup. Never allow same-origin or top navigation.
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="'+policy+'"><meta name="referrer" content="no-referrer">'+html.replace(/^\s*<!doctype[^>]*>/i,'');
}
export function openProjectPreview(p:StudioProject){
  document.getElementById('kodexa-preview')?.remove();
  const dialog=node('dialog');dialog.id='kodexa-preview';dialog.setAttribute('aria-label','Prévia do aplicativo');document.body.append(dialog);
  const title=node('h2','Prévia do aplicativo'),status=node('p','Carregando prévia…');status.setAttribute('role','status');
  const frame=node('iframe');frame.title='Prévia isolada do projeto';frame.setAttribute('sandbox','');frame.referrerPolicy='no-referrer';frame.hidden=true;
  let data:StudioPreview|undefined,scripts=false,closed=false;
  function render(){if(!data||closed)return;frame.setAttribute('sandbox',scripts?'allow-scripts':'');frame.srcdoc=previewDocument(data.html,scripts);frame.hidden=false;status.textContent='Arquivo: '+data.entry+' · '+(scripts?'JavaScript local autorizado; API e recursos externos bloqueados.':'Visualização estática, sem JavaScript.');}
  const toggle=button('Ativar JavaScript local',()=>{if(!scripts&&!confirm('Execute apenas código revisado e confiável. A prévia fica em uma origem isolada e não deve receber dados reais. A sandbox não é uma máquina virtual. Continuar?'))return;scripts=!scripts;toggle.textContent=scripts?'Desativar JavaScript':'Ativar JavaScript local';render();});toggle.disabled=true;
  const port=node('input');port.type='number';port.min='1024';port.max='65535';port.value='8000';port.setAttribute('aria-label','Porta privada do aplicativo');
  const link=node('a','Abrir versão completa do aplicativo');link.target='_blank';link.rel='noopener noreferrer';link.hidden=true;
  const hint=node('p','Se a prévia ficar em Carregando, a interface provavelmente depende de uma API. Abra a versão completa pela porta privada abaixo, após iniciar o servidor conforme o README. A prévia HTML não executa o backend.');
  let codespaceOrigin=location.origin;
  const updateLink=()=>{const url=privatePortUrl(codespaceOrigin,Number(port.value));if(url){link.href=url;link.hidden=false;}else{link.removeAttribute('href');link.hidden=true;}};
  port.oninput=updateLink;updateLink();
  const runtimePanel=node('section');runtimePanel.setAttribute('aria-label','Servidor de demonstração');
  const runtimeStatus=node('p','Verificando servidor…');runtimeStatus.setAttribute('role','status');
  const start=button('Iniciar aplicativo',()=>{if(confirm('Iniciar uma cópia temporária da demonstração verificada, sem dados reais? Confirme que a porta 8010 permanecerá Privada.'))void runtimeAction('start');});
  const stop=button('Parar aplicativo',()=>void runtimeAction('stop'));
  const open=node('a','Abrir aplicativo online');open.target='_blank';open.rel='noopener noreferrer';open.hidden=true;
  let runtimeBusy=false;
  const runtimeBase='/api/studio/projects/'+encodeURIComponent(p.id)+'/runtime';
  async function runtimeRequest(action?:'start'|'stop'){
    const response=await fetch(runtimeBase+(action?'/'+action:''),{credentials:'same-origin',cache:'no-store',...(action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approved:true})}:{})});
    const result=await response.json();if(!response.ok)throw Error(result.error??'Servidor indisponível.');return result as StudioRuntime;
  }
  function showRuntime(r:StudioRuntime){if(closed)return;codespaceOrigin=r.codespaceOrigin??location.origin;updateLink();runtimeStatus.textContent=r.message;start.disabled=runtimeBusy||!r.available||r.state!=='stopped';stop.disabled=runtimeBusy||!['starting','running'].includes(r.state);const url=r.state==='running'&&r.port?privatePortUrl(codespaceOrigin,r.port):undefined;if(url){open.href=url;open.hidden=false;}else{open.hidden=true;open.removeAttribute('href');}}
  async function refreshRuntime(){if(closed||runtimeBusy)return;try{showRuntime(await runtimeRequest());}catch(e){if(!closed)runtimeStatus.textContent=(e as Error).message;}}
  async function runtimeAction(action:'start'|'stop'){if(runtimeBusy)return;runtimeBusy=true;start.disabled=true;stop.disabled=true;runtimeStatus.textContent=action==='start'?'Iniciando servidor…':'Parando servidor…';try{const result=await runtimeRequest(action);runtimeBusy=false;showRuntime(result);}catch(e){runtimeBusy=false;if(!closed){runtimeStatus.textContent=(e as Error).message;start.disabled=false;}}}
  start.disabled=true;stop.disabled=true;runtimePanel.append(node('h3','Servidor de demonstração'),runtimeStatus,start,stop,open,node('p','A execução usa somente a versão verificada do Oficina em Dia, uma cópia descartável e a porta privada 8010. A sessão é encerrada após uma hora. Outros backends ainda exigem o README.'));
  const poll=setInterval(()=>void refreshRuntime(),2500);
  const close=button('Fechar prévia',()=>dialog.close());
  dialog.append(title,close,runtimePanel,node('p','Prévia HTML local sem iniciar processos no servidor. APIs, recursos externos e navegação superior não fazem parte da prévia.'),status,toggle,frame,hint,port,link);
  dialog.addEventListener('close',()=>{closed=true;clearInterval(poll);frame.srcdoc='';dialog.remove();},{once:true});
  dialog.showModal();void refreshRuntime();
  void fetch('/api/studio/projects/'+encodeURIComponent(p.id)+'/preview',{credentials:'same-origin',cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error??'Prévia indisponível.');return d as StudioPreview;}).then(d=>{if(closed)return;data=d;toggle.disabled=false;render();}).catch(e=>{if(!closed)status.textContent=String(e.message??e);});
}
