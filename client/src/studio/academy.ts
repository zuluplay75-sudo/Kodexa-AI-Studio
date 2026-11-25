import { STAGES } from '../../../shared/studio-project';
import { MEDIA_LIMIT,type StudyInfo } from '../../../shared/academy-study';
function el<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string):HTMLElementTagNameMap[K]{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
function button(text:string,fn:()=>void){const b=el('button',text);b.type='button';b.onclick=fn;return b;}
async function req<T>(path:string,body?:unknown):Promise<T>{
  const r=await fetch('/api/studio/academy'+path,{credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw Error(typeof data?.error==='string'?data.error:'Academy indisponível.');
  return data as T;
}
function base64(file:File):Promise<string>{return new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]??'');r.onerror=()=>fail(Error('Falha ao ler arquivo'));r.readAsDataURL(file);});}
export function openAcademy(){
  let existing=document.getElementById('kodexa-academy-panel') as HTMLDialogElement|null;
  if(existing){if(!existing.open)existing.showModal();return;}
  const d=el('dialog');d.id='kodexa-academy-panel';d.className='kodexa-study-dialog';d.setAttribute('aria-label','Kodexa Academy');
  const role=el('select');role.setAttribute('aria-label','Cargo que vai estudar');
  for(const s of STAGES){const opt=el('option',s[1]);opt.value=s[0];role.append(opt);}
  const source=el('input');source.placeholder='Referência ou link do material';source.maxLength=500;
  const text=el('textarea');text.rows=6;text.maxLength=16000;text.placeholder='Cole artigo ou transcrição autorizada (100–16000 caracteres).';
  const file=el('input');file.type='file';file.accept='.mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm';
  const status=el('p');status.setAttribute('role','status');const results=el('div');
  let info:StudyInfo|undefined,busy=false,poll:ReturnType<typeof setInterval>|undefined;
  const go=button('Estudar texto ou mídia',()=>void submit());
  const link=button('Estudar artigo pelo link',()=>void submit(true));
  async function refresh(){try{
    info=await req<StudyInfo>('');go.disabled=busy||!info.enabled||info.jobs.some(j=>j.state==='running');file.disabled=!info.mediaEnabled||busy;link.disabled=go.disabled;
    results.replaceChildren(el('p',info.enabled?'Academy habilitada.':'Academy ainda não habilitada no servidor.'));
    for(const j of info.jobs.slice(0,8))results.append(el('p',j.source+' — '+({running:'estudando',done:'nota criada',failed:'falhou'}[j.state])+(j.error?' · '+j.error:'')));
    for(const n of info.notes){const detail=el('details');detail.append(el('summary',n.role+' · '+n.source+' (não validado)'),el('pre',n.text));results.append(detail);}
    if(info.videos.length)results.append(el('h3','Vídeos encontrados — ainda não estudados'));
    for(const v of info.videos){if(!/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(v.url))continue;const a=el('a',v.role+' · '+v.title);a.href=v.url;a.target='_blank';a.rel='noopener noreferrer';results.append(a);}
  }catch(e){status.textContent=(e as Error).message;go.disabled=true;link.disabled=true;}}
  async function submit(fromLink=false){
    if(busy||!info?.enabled)return;
    const f=fromLink?undefined:file.files?.[0];if(f&&f.size>MEDIA_LIMIT){status.textContent='Arquivo maior que 8 MB.';return;}
    if(!confirm('Você tem autorização para usar este material e enviar seu conteúdo ao provedor de IA? A chamada pode gerar cobrança.'))return;
    busy=true;go.disabled=true;link.disabled=true;status.textContent='Enviando…';
    try{await req('/study',{role:role.value,source:source.value,approved:true,...(fromLink?{link:source.value}:f?{media:await base64(f),filename:f.name}:{text:text.value})});status.textContent='Estudo iniciado no servidor.';text.value='';file.value='';}
    catch(e){status.textContent=(e as Error).message;}
    finally{busy=false;await refresh();}
  }
  d.append(el('h2','Kodexa Academy'),button('Fechar',()=>d.close()),el('p','Envie um link HTTPS de artigo público, texto, transcrição ou mídia de até 8 MB. A leitura de artigos usa até 16000 caracteres; vídeos são estudados pelo áudio do arquivo autorizado. Links de vídeos não são baixados. As notas ficam disponíveis aos agentes, mas não são automaticamente validadas.'),role,source,link,text,file,go,status,results);
  document.body.append(d);d.addEventListener('close',()=>{if(poll)clearInterval(poll);d.remove();});d.showModal();void refresh();poll=setInterval(()=>{if(!busy&&info?.jobs.some(j=>j.state==='running'))void refresh();},3000);
}
