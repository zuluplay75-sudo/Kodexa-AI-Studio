import {spawn,type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {closeSync,constants,existsSync,fstatSync,mkdirSync,mkdtempSync,openSync,readSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createServer} from 'node:net';
import type {StudioRuntime} from '../../shared/studio-project';

// First supported backend: the exact owner-reviewed Oficina em Dia demo export.
// No arbitrary scripts, arguments, dependencies, shell, project database, or secrets.
const files:Record<string,string[]> = {
 'app.py':['f6fbc2e56b112eb00851a774175633ace0937db107e351866c98c3f4c8e8213c','9768421fb2751a64cf5fc17e6d514a2305c51179760ef937d952fcaeefd3bd63'],
 'oficina.py':['f164d8774c470c76ac6cd09d8386e3bd6e3f5f33a8f5fb5977b2b644de32a5fe'],
 'schema.sql':['be7c99ac37d96424688931b8fc998e25b23c187943206adca74582ec018f52e8'],
 'static/app.js':['5e2db9cab0a314af1c834b70c9739d1310a0ccef1f3504e4906823816dd6b0a5'],
 'static/index.html':['59ee4190a694a79b3ad2391bff251f025ec35c13d58338bbc2db81768de8b11f'],
 'static/style.css':['37244c3e793056ec302e523ad9a3263a90ff308aa21694fbda9b66be4346d6ee'],
};
const original="        if origens and origens != [f'{esquema}://{autoridade}']:";
const corrected=[
 "        permitidas = {f'{esquema}://{autoridade}'}",
 "        nome = os.environ.get('CODESPACE_NAME')",
 "        dominio = os.environ.get('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', 'app.github.dev')",
 "        if self.server.demo and self.server.secure and nome:",
 "            permitidas.add(f'https://{nome}-{self.server.server_port}.{dominio}')",
 "        if origens and (len(origens) != 1 or origens[0] not in permitidas):",
].join('\n');
const PROFILE='Oficina em Dia · demonstração verificada';
const PORT=8010;
export function verifiedDemo(workspace:string):Map<string,Buffer>{
 const root=realpathSync(workspace),out=new Map<string,Buffer>();
 for(const [name,hashes] of Object.entries(files)){
  const path=join(root,name);
  if(realpathSync(path)!==path)throw Error('Invalid demo path');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const stat=fstatSync(fd);
   if(!stat.isFile()||stat.nlink!==1||stat.size>512*1024)throw Error('Invalid demo file');
   const b=Buffer.alloc(stat.size);let pos=0;
   while(pos<b.length){const n=readSync(fd,b,pos,b.length-pos,pos);if(!n)throw Error('Short read');pos+=n;}
   if(!hashes.includes(createHash('sha256').update(b).digest('hex')))throw Error('Unrecognized demo version');
   out.set(name,name==='app.py'?Buffer.from(b.toString('utf8').replace(original,corrected)):b);
  }finally{closeSync(fd);}
 }
 return out;
}
function localPortFree(port:number):Promise<boolean>{
 return new Promise(resolve=>{
   const server=createServer();server.once('error',()=>resolve(false));
   server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));
 });
}
function supportedEnv(env:NodeJS.ProcessEnv):boolean{
 return process.platform==='linux'&&env.KODEXA_RUNTIME_ENABLED==='1'&&
  /^[a-z0-9-]+$/.test(env.CODESPACE_NAME??'')&&env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN==='app.github.dev';
}
type Job={id:string;state:StudioRuntime['state'];child?:ChildProcess;dir?:string;timer?:ReturnType<typeof setTimeout>;message:string;cancelled:boolean};
export class DemoRuntime{
 private job?:Job;
 constructor(private readonly root:string,private readonly env:NodeJS.ProcessEnv){}
 status(id:string,workspace:string):StudioRuntime{
  const name=this.env.CODESPACE_NAME;
  const codespaceOrigin=name&&/^[a-z0-9-]+$/.test(name)&&this.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN==='app.github.dev'
   ? 'https://'+name+'-4748.app.github.dev'
   : undefined;
  const current=this.job;
  if(current?.id===id)return {codespaceOrigin,available:true,state:current.state,port:PORT,message:current.message,profile:PROFILE};
  if(!supportedEnv(this.env))return {codespaceOrigin,available:false,state:'stopped',message:'Inicialização automática desabilitada neste ambiente.'};
  try{verifiedDemo(workspace);}catch{return {codespaceOrigin,available:false,state:'stopped',message:'Backend ainda não suportado ou versão alterada. Use o README e uma porta privada.'};}
  if(current)return {codespaceOrigin,available:false,state:'stopped',message:'Outra demonstração está em execução.'};
  return {codespaceOrigin,available:true,state:'stopped',port:PORT,message:'Pronto para iniciar cópia temporária com dados de demonstração.',profile:PROFILE};
 }
 async start(id:string,workspace:string):Promise<StudioRuntime>{
  if(!supportedEnv(this.env)||this.job)throw Error('Runtime indisponível ou ocupado.');
  const snapshot=verifiedDemo(workspace);
  const job:Job={id,state:'starting',message:'Preparando demonstração…',cancelled:false};
  this.job=job;
  try{
   if(!await localPortFree(PORT))throw Error('Porta 8010 ocupada. Feche o servidor que a utiliza.');
   if(job.cancelled)throw Error('Inicialização cancelada.');
   mkdirSync(this.root,{recursive:true,mode:0o700});
   job.dir=mkdtempSync(join(this.root,'demo-'));
   for(const [name,bytes] of snapshot){const path=join(job.dir,name);mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,bytes,{flag:'wx',mode:0o600});}
   const python=['/usr/bin/python3','/usr/local/bin/python3'].find(p=>existsSync(p));
   if(!python)throw Error('Python 3 não encontrado.');
   const child=spawn(python,['-E','-s','-B','app.py','servir','--demo','--cookie-secure','--host','127.0.0.1','--porta',String(PORT)],{
    cwd:job.dir,env:{PATH:'/usr/bin:/bin',HOME:job.dir,TMPDIR:job.dir,LANG:'C.UTF-8',CODESPACE_NAME:this.env.CODESPACE_NAME,GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'app.github.dev'},stdio:'ignore',shell:false,
   });
   job.child=child;
   child.once('error',()=>this.finish(job,'Falha ao iniciar Python.'));
   child.once('exit',()=>this.finish(job,job.cancelled?'Demonstração encerrada.':'Servidor de demonstração encerrou inesperadamente.'));
   for(let n=0;n<50;n++){
    if(this.job!==job||job.cancelled||child.exitCode!==null||child.signalCode!==null)break;
    try{
     const response=await fetch('http://127.0.0.1:'+PORT+'/api/sessao',{redirect:'error',signal:AbortSignal.timeout(400)});
     const body=await response.json() as {demo?:boolean};
     if(response.ok&&body.demo===true&&this.job===job&&!job.cancelled&&child.exitCode===null){
      job.state='running';job.message='Demonstração online. Confirme a porta 8010 como Privada.';
      job.timer=setTimeout(()=>this.stop(id),60*60*1000);job.timer.unref();
      return this.status(id,workspace);
     }
    }catch{/* wait for startup */}
    await new Promise(resolve=>setTimeout(resolve,200));
   }
   throw Error('O servidor não respondeu à verificação de saúde.');
  }catch(err){
   if(this.job===job){if(job.child){job.cancelled=true;job.state='stopping';job.child.kill('SIGKILL');}else this.finish(job,'Falha na inicialização.');}
   throw err;
  }
 }
 stop(id:string):void{
  const job=this.job;if(!job||job.id!==id)return;
  job.cancelled=true;job.state='stopping';job.message='Encerrando demonstração…';
  if(job.timer)clearTimeout(job.timer);
  if(job.child){job.child.kill('SIGKILL');}else this.finish(job,'Demonstração encerrada.');
 }
 shutdown():void{if(this.job)this.stop(this.job.id);}
 private finish(job:Job,_message:string){
  if(job.timer)clearTimeout(job.timer);
  if(job.dir)try{rmSync(job.dir,{recursive:true,force:true});}catch{/* cleanup best effort */}
  if(this.job===job)this.job=undefined;
 }
}
