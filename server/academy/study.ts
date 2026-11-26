import { randomUUID } from 'node:crypto';
import { mkdirSync,readFileSync,writeFileSync,renameSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { CURRICULUM,studyTranscript,studyVideo,type AcademyState,type Role } from './bootstrap';
import { MEDIA_LIMIT,type StudyInfo,type StudyJob } from '../../shared/academy-study';
import { articleUrl,readPublicArticle } from './web-source';
import { analyzeVideo,visionEnabled } from './video-vision';
export class StudyError extends Error{constructor(readonly status:number,message:string){super(message)}}
function state(dir:string):AcademyState|undefined{
  try{return JSON.parse(readFileSync(join(dir,'state.json'),'utf8')) as AcademyState;}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}
}
export function knowledgeFor(dir:string,role:Role){
  try{return (state(dir)?.notes??[]).filter(n=>n.role===role).slice(-4).map(n=>({source:n.source,text:n.text.slice(0,1500),validated:false}));}
  catch{return [];}
}
type Options={dir:string;env?:NodeJS.ProcessEnv;fetcher?:typeof fetch;study?:typeof studyTranscript;readArticle?:typeof readPublicArticle;vision?:typeof analyzeVideo};
const EXT=new Set(['mp3','mp4','mpeg','mpga','m4a','wav','webm']);
export class AcademyStudy{
  private jobs:StudyJob[]=[];
  private readonly env:NodeJS.ProcessEnv;
  private readonly file:string;
  constructor(private readonly o:Options){
    this.env=o.env??process.env;
    mkdirSync(o.dir,{recursive:true,mode:0o700});
    this.file=join(o.dir,'study-jobs.json');
    try{const data=JSON.parse(readFileSync(this.file,'utf8'));if(!Array.isArray(data))throw Error('Invalid jobs');this.jobs=data;}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    let changed=false;
    for(const j of this.jobs)if(j.state==='running'){j.state='failed';j.error='Servidor reiniciado; envie o material novamente.';changed=true;}
    if(changed)this.save();
  }
  private save(){
    const tmp=this.file+'.'+randomUUID();
    try{writeFileSync(tmp,JSON.stringify(this.jobs),{mode:0o600,flag:'wx'});renameSync(tmp,this.file);}
    finally{rmSync(tmp,{force:true});}
  }
  private enabled(){return this.env.KODEXA_ACADEMY_AUTO==='1'&&!!this.env.KODEXA_ACADEMY_MODEL&&((this.env.KODEXA_ACADEMY_PROVIDER==='openai'&&!!this.env.OPENAI_API_KEY)||(this.env.KODEXA_ACADEMY_PROVIDER==='anthropic'&&!!this.env.ANTHROPIC_API_KEY));}
  info():StudyInfo{
    const data=state(this.o.dir);
    return {enabled:this.enabled(),mediaEnabled:this.enabled()&&!!this.env.OPENAI_API_KEY,videoEnabled:visionEnabled(this.env),jobs:structuredClone(this.jobs.slice(-30).reverse()),notes:(data?.notes??[]).slice(-40).reverse(),videos:(data?.jobs??[]).flatMap(j=>j.videos.map(v=>({role:j.role,title:v.title,url:v.url})))};
  }
  launch(raw:unknown):StudyJob{
    const visual=(raw as {visual?:unknown}|null)?.visual===true;
    if(visual?!visionEnabled(this.env):!this.enabled())throw new StudyError(409,'Configure e habilite o modo de estudo no servidor.');
    if(this.jobs.some(j=>j.state==='running'))throw new StudyError(409,'Aguarde o estudo em andamento.');
    const b=raw as {role?:unknown;source?:unknown;text?:unknown;media?:unknown;filename?:unknown;approved?:unknown;link?:unknown}|null;
    const role=CURRICULUM.find(x=>x.id===b?.role)?.id;
    let source=typeof b?.source==='string'?b.source.trim():'';
    const link=typeof b?.link==='string'?b.link.trim():'';
    if(link){try{source=articleUrl(link).href;}catch{throw new StudyError(400,'Use um link HTTPS público de artigo. Links de vídeo exigem transcrição ou mídia autorizada.');}}
    if(!role||!source||source.length>500||b?.approved!==true)throw new StudyError(400,'Informe cargo, referência e autorize o envio ao provedor.');
    const text=typeof b.text==='string'?b.text.trim():'';
    const media=typeof b.media==='string'?b.media:'';
    const kind=visual?'video':media?'media':link?'link':'text';
    if(visual&&(!media||link||text))throw new StudyError(400,'Envie somente um vídeo autorizado.');
    if(link&&(text||media))throw new StudyError(400,'Envie um tipo de material por vez.');
    let bytes:Buffer|undefined,filename='';
    if(media){
      if(!visual&&!this.env.OPENAI_API_KEY)throw new StudyError(409,'Transcrição de mídia requer OpenAI.');
      const ext=typeof b.filename==='string'?b.filename.split('.').at(-1)?.toLowerCase():'';
      if(!ext||!EXT.has(ext)||(visual&&!['mp4','webm'].includes(ext))||text||media.length>Math.ceil(MEDIA_LIMIT/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(media))throw new StudyError(400,'Mídia inválida. Use áudio ou MP4/WebM até 8 MB.');
      bytes=Buffer.from(media,'base64');
      if(!bytes.length||bytes.length>MEDIA_LIMIT)throw new StudyError(400,'Mídia excede o limite.');
      if(visual&&(ext==='mp4'?(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp'):(bytes.length<4||bytes.readUInt32BE(0)!==0x1a45dfa3)))throw new StudyError(400,'Contêiner de vídeo inválido.');
      filename='source.'+ext;
      const today=new Date().toISOString().slice(0,10);
      if(this.jobs.filter(j=>(j.kind==='media'||j.kind==='video')&&j.at.startsWith(today)).length>=4)throw new StudyError(429,'Limite diário de quatro transcrições.');
    }else if(!link&&(text.length<100||text.length>16000))throw new StudyError(400,'Use 100–16000 caracteres por trecho de texto ou transcrição.');
    const j:StudyJob={id:randomUUID(),role,source,kind,state:'running',at:new Date().toISOString()};
    const before=this.jobs;
    this.jobs=[...this.jobs.slice(-99),j];
    try{this.save();}catch(e){this.jobs=before;throw e;}
    void this.run(j,text,bytes,filename);
    return structuredClone(j);
  }
  private async run(j:StudyJob,text:string,bytes?:Buffer,filename=''){
    try{
      if(j.kind==='video'){
        await studyVideo({dir:this.o.dir,env:this.env},j.role,j.source,()=> (this.o.vision??analyzeVideo)(this.env,j.role,bytes!,filename));
        j.state='done';
      }else{
      if(j.kind==='link')text=await (this.o.readArticle??readPublicArticle)(j.source);
      if(bytes){
        const form=new FormData();
        form.append('file',new Blob([new Uint8Array(bytes)]),filename);
        form.append('model','whisper-1');
        const r=await (this.o.fetcher??fetch)('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+this.env.OPENAI_API_KEY},body:form,redirect:'error',signal:AbortSignal.timeout(90000)});
        if(!r.ok)throw Error('Transcription failed');
        const data=await r.json() as {text?:unknown};
        text=typeof data.text==='string'?data.text.trim():'';
        if(text.length<100||text.length>16000){j.error='Transcrição curta demais ou longa demais; divida a mídia em trechos menores.';throw Error('Transcript length');}
      }
      await (this.o.study??studyTranscript)({dir:this.o.dir,env:this.env,fetcher:this.o.fetcher},j.role,j.source,text);
      j.state='done';
      }
    }catch{j.state='failed';j.error??='Estudo não concluído. Confira as credenciais, limite diário e se outro estudo automático está ativo.';}
    try{this.save();}catch{j.state='failed';j.error='Não foi possível salvar o estado do estudo.';}
  }
}
