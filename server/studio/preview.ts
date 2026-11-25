import {closeSync,constants,fstatSync,openSync,readSync,realpathSync} from 'node:fs';
import {posix,relative,resolve,sep} from 'node:path';
const MAX_FILE=512*1024,MAX_TOTAL=2*1024*1024;
const ENTRIES=['index.html','static/index.html','public/index.html','dist/index.html','build/index.html'];
function safeRead(root:string,path:string):Buffer{
  if(!path||path.split('/').some(x=>!x||x==='.'||x==='..'||x.startsWith('.'))||!/^[a-zA-Z0-9_./ -]+$/.test(path))throw Error('Invalid path');
  const full=resolve(root,path);
  if(!relative(root,full)||!full.startsWith(root+sep)||realpathSync(full)!==full)throw Error('Invalid workspace file');
  const fd=openSync(full,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const st=fstatSync(fd);
    if(!st.isFile()||st.nlink!==1||st.size>MAX_FILE)throw Error('Invalid preview file');
    const buf=Buffer.alloc(st.size);
    let offset=0;
    while(offset<buf.length){const n=readSync(fd,buf,offset,buf.length-offset,offset);if(!n)break;offset+=n;}
    return buf.subarray(0,offset);
  }finally{closeSync(fd);}
}
function asset(root:string,entry:string,url:string,ext:string):Buffer|undefined{
  if(!url||url.includes('\\')||url.includes(':')||url.startsWith('//')||url.includes('%')||url.includes('?')||url.includes('#')||url.split('/').includes('..')||!url.toLowerCase().endsWith(ext))return undefined;
  // A backend often mounts static/ or public/ at the web root, not at /static/.
  const name=url.startsWith('/')?url.slice(1):url;
  const candidates=[posix.join(posix.dirname(entry),name),...(url.startsWith('/')?[name]:[])];
  for(const candidate of new Set(candidates)){try{return safeRead(root,candidate);}catch{/* next bounded candidate */}}
  return undefined;
}
export function readPreview(workspace:string):{html:string;entry:string}{
  const root=realpathSync(workspace);
  let entry='',html='',total=0;
  for(const candidate of ENTRIES){try{const b=safeRead(root,candidate);entry=candidate;html=b.toString('utf8');total=b.length;break;}catch{/* try next entry */}}
  if(!entry||!html.trim())throw Error('No HTML entry');
  // Only literal quoted local CSS/JS links; no network fetches or arbitrary server paths.
  // The result is JSON, never served as executable HTML on the Kodexa origin.
  const inline=(url:string,ext:string,mime:string)=>{
    const b=asset(root,entry,url,ext);if(!b||total+b.length>MAX_TOTAL)return undefined;
    total+=b.length;return 'data:'+mime+';base64,'+b.toString('base64');
  };
  html=html.replace(/<link\b[^>]*\bhref\s*=\s*(["'])([^"'<>]+)\1[^>]*>/gi,(tag:string,_q:string,url:string)=>{
    if(!/\brel\s*=\s*(?:"stylesheet"|'stylesheet'|stylesheet)(?:\s|\/?>)/i.test(tag))return tag;
    const data=inline(url,'.css','text/css');return data?'<link rel="stylesheet" href="'+data+'">':tag;
  });
  html=html.replace(/<script\b([^>]*?)\bsrc\s*=\s*(["'])([^"'<>]+)\2([^>]*)>/gi,(tag:string,pre:string,_q:string,url:string,post:string)=>{
    const data=inline(url,'.js','text/javascript');return data?'<script'+pre+'src="'+data+'"'+post+'>':tag;
  });
  return {html,entry};
}
