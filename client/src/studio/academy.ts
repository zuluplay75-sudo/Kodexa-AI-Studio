import { subtitleTranscript } from './subtitles';
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
  const subtitles=el('input');subtitles.type='file';subtitles.accept='.srt,.vtt,.txt';subtitles.setAttribute('aria-label','Importar legenda ou transcrição');
  const status=el('p');status.setAttribute('role','status');const results=el('div');
  let info:StudyInfo|undefined,busy=false,poll:ReturnType<typeof setInterval>|undefined;
  subtitles.onchange=async()=>{
    const f=subtitles.files?.[0];if(!f)return;
    try{
      if(f.size>512*1024)throw Error('Legenda maior que 512 KB. Divida o arquivo.');
      const raw=await f.text();
      const transcript=/\.txt$/i.test(f.name)?raw.trim():subtitleTranscript(raw);
      if(transcript.length<100||transcript.length>16000)throw Error('Use 100–16000 caracteres por transcrição.');
      text.value=transcript;file.value='';if(!source.value.trim())source.value=f.name.slice(0,500);
      status.textContent='Transcrição importada localmente. Revise antes de enviar.';
    }catch(e){status.textContent=(e as Error).message;}
    finally{subtitles.value='';}
  };
  const go=button('Estudar texto ou mídia',()=>void submit());
  const link=button('Estudar artigo pelo link',()=>void submit(true));
  const visual=button('Assistir vídeo com Claude',()=>void submit(false,true));
  async function refresh(){try{
    info=await req<StudyInfo>('');const running=busy||info.jobs.some(j=>j.state==='running');go.disabled=running||!info.enabled;visual.disabled=running||!info.videoEnabled;file.disabled=running||(!info.mediaEnabled&&!info.videoEnabled);subtitles.disabled=!info.enabled||running;link.disabled=go.disabled;
    results.replaceChildren(el('p',info.enabled?'Academy habilitada.':'Academy ainda não habilitada no servidor.'));
    results.append(el('p',info.videoEnabled?'Claude Video Vision configurado; selecione um MP4 ou WebM autorizado.':'Claude Video Vision ainda não configurado no servidor.'));
    for(const j of info.jobs.slice(0,8))results.append(el('p',j.source+' — '+({running:'estudando',done:'nota criada',failed:'falhou'}[j.state])+(j.error?' · '+j.error:'')));
    for(const n of info.notes){const detail=el('details');detail.append(el('summary',n.role+' · '+n.source+(n.kind==='video'?' · audiovisual':'')+' (não validado)'),el('pre',n.text));results.append(detail);}
    if(info.videos.length)results.append(el('h3','Vídeos encontrados — ainda não estudados'));
    for(const v of info.videos){if(!/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(v.url))continue;const a=el('a',v.role+' · '+v.title);a.href=v.url;a.target='_blank';a.rel='noopener noreferrer';results.append(a);}
  }catch(e){status.textContent=(e as Error).message;go.disabled=true;link.disabled=true;visual.disabled=true;}}
  async function submit(fromLink=false,watch=false){
    if(busy||!(watch?info?.videoEnabled:info?.enabled))return;
    const f=fromLink?undefined:file.files?.[0];if(f&&f.size>MEDIA_LIMIT){status.textContent='Arquivo maior que 8 MB.';return;}
    if(watch&&(!f||!/\.(mp4|webm)$/i.test(f.name))){status.textContent='Selecione um vídeo MP4 ou WebM.';return;}
    if(!confirm(watch?'Você autoriza enviar imagens e transcrição dos primeiros 30 segundos deste vídeo ao Claude? O processamento usa a sua conta e pode consumir a franquia.':'Você tem autorização para usar este material e enviar seu conteúdo ao provedor de IA? A chamada pode gerar cobrança.'))return;
    busy=true;go.disabled=true;link.disabled=true;visual.disabled=true;status.textContent='Enviando…';
    try{await req('/study',{role:role.value,source:source.value,approved:true,...(watch?{visual:true}:{}),...(fromLink?{link:source.value}:f?{media:await base64(f),filename:f.name}:{text:text.value})});status.textContent='Estudo iniciado no servidor.';text.value='';file.value='';}
    catch(e){status.textContent=(e as Error).message;}
    finally{busy=false;await refresh();}
  }
  d.append(el('h2','Kodexa Academy'),button('Fechar',()=>d.close()),el('p','Envie um link HTTPS de artigo público, texto, transcrição ou mídia de até 8 MB. A leitura de artigos usa até 16000 caracteres; vídeos podem ser estudados pelo áudio ou, quando configurado, por imagens e áudio dos primeiros 30 segundos com Claude Video Vision. Links de vídeos não são baixados. As notas ficam disponíveis aos agentes, mas não são automaticamente validadas.'),role,source,link,text,el('p','Importar legenda SRT, VTT ou TXT (até 512 KB)'),subtitles,file,go,visual,status,results);
  document.body.append(d);d.addEventListener('close',()=>{if(poll)clearInterval(poll);d.remove();});d.showModal();void refresh();poll=setInterval(()=>{if(!busy&&info?.jobs.some(j=>j.state==='running'))void refresh();},3000);
}
