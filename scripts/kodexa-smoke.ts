import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {hashPassword} from '../server/remote/password';
const dir=mkdtempSync(join(tmpdir(),'kodexa-smoke-'));
const host='smoke-4748.app.github.dev';
const password='smoke-test-only-123';
const hash=await hashPassword(password,10);
const child=spawn(process.execPath,['dist/server/index.js'],{env:{PATH:process.env.PATH,HOME:dir,CODESPACES:'true',CODESPACE_NAME:'smoke',GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'app.github.dev',HABBLAUD_CODESPACE_LOGIN:'1',HABBLAUD_IN_DOCKER:'0',HABBLAUD_DATA_DIR:join(dir,'data'),HABBLAUD_HOST:'127.0.0.1',HABBLAUD_PORT:'4747',HABBLAUD_REMOTE_USER:'smoke',HABBLAUD_REMOTE_PASSWORD_HASH:hash,HABBLAUD_REMOTE_ALLOW:'messages,spawn',HABBLAUD_DEMO:'0',HABBLAUD_WORLD:'0',HABBLAUD_UPDATE_CHECK:'0',HABBLAUD_CODEX:'0',HABBLAUD_TERMINAL:'0',HABBLAUD_PTY:'0',HABBLAUD_TIMELINE:'0'},stdio:['ignore','pipe','pipe']});
let logs='';for(const s of [child.stdout,child.stderr])s?.on('data',c=>{logs=(logs+String(c)).slice(-10000);});
type Reply={status:number;headers:http.IncomingHttpHeaders;body:string};
function call(port:number,path:string,opts:{host?:string;cookie?:string;body?:unknown}={}):Promise<Reply>{
  return new Promise((ok,fail)=>{
    const body=opts.body===undefined?undefined:JSON.stringify(opts.body);
    const r=http.request({hostname:'127.0.0.1',port,path,method:body===undefined?'GET':'POST',headers:{Host:opts.host??host,...(opts.cookie?{Cookie:opts.cookie}:{}),...(body!==undefined?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{})}},res=>{
      let text='';res.on('data',c=>text+=c);res.on('end',()=>ok({status:res.statusCode??0,headers:res.headers,body:text}));
    });
    r.setTimeout(5000,()=>r.destroy(Error('request timeout')));r.on('error',fail);r.end(body);
  });
}
try{
  let ready=false;for(let i=0;i<80;i++){try{ready=(await call(4748,'/login')).status===200;if(ready)break;}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,250));}
  assert(ready,'Production server failed to start');
  assert.equal((await call(4747,'/api/studio')).status,403);
  assert.equal((await call(4748,'/api/studio')).status,401);
  assert.equal((await call(4748,'/api/studio/academy')).status,401);
  assert.equal((await call(4748,'/api/studio/providers',{body:{}})).status,401);
  assert.equal((await call(4748,'/api/studio/providers')).status,401);
  assert.match((await call(4748,'/login')).body,/Kodexa AI Studio/);
  const login=await call(4748,'/api/remote/login',{body:{user:'smoke',password}});
  assert.equal(login.status,200);
  const header=login.headers['set-cookie']?.[0]??'';assert.match(header,/HttpOnly/);assert.match(header,/Secure/);
  const cookie=header.split(';')[0];
  const studio=await call(4748,'/api/studio',{cookie});assert.equal(studio.status,200);assert.equal(JSON.parse(studio.body).configured,false);
  assert.equal((await call(4748,'/api/studio/academy',{cookie})).status,200);
  const project=await call(4748,'/api/studio/projects',{cookie,body:{brief:'Projeto de teste automatizado',research:false}});assert.equal(project.status,201);
  const before=JSON.parse(studio.body).routing.routing;
  const routing={...before,roles:{...before.roles,scout:'gemini',manager:'claude-cli'},fallback:false};
  const configured=await call(4748,'/api/studio/providers',{cookie,body:routing});assert.equal(configured.status,200);
  const reloaded=JSON.parse((await call(4748,'/api/studio',{cookie})).body);
  assert.deepEqual(reloaded.routing.routing,routing);
  const usage=await call(4748,'/api/studio/providers',{cookie});assert.equal(usage.status,200);
  const usageData=JSON.parse(usage.body);assert.deepEqual(usageData.routing,routing);assert.equal(usageData.providers.length,3);assert.equal('projects' in usageData,false);
  assert.equal(reloaded.projects[0].id,JSON.parse(project.body).id);
  assert.equal((await call(4748,'/api/remote/logout',{cookie,body:{}})).status,200);
  assert.equal((await call(4748,'/api/studio',{cookie})).status,401);
  console.log('Kodexa production smoke: login, protected routes, project persistence API and logout passed.');
}catch(e){console.error(logs);throw e;}
finally{child.kill('SIGTERM');await new Promise<void>(r=>{if(child.exitCode!==null||child.signalCode!==null)r();else{child.once('exit',()=>r());setTimeout(()=>{child.kill('SIGKILL');r();},3000).unref();}});rmSync(dir,{recursive:true,force:true});}
