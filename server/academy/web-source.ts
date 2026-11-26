import https from 'node:https';
import { Resolver } from 'node:dns/promises';
import { checkServerIdentity } from 'node:tls';
import { isIP } from 'node:net';
import { documentExcerpt } from './bootstrap';
const MAX=1024*1024;
export function publicIpv4(ip:string):boolean{
  if(isIP(ip)!==4)return false;
  const [a,b,c]=ip.split('.').map(Number);
  if(a===0||a===10||a===127||a>=224||a===169&&b===254||a===100&&b>=64&&b<=127||a===172&&b>=16&&b<=31||a===192&&b===168||a===192&&b===0&&(c===0||c===2)||a===192&&b===88&&c===99||a===198&&(b===18||b===19)||a===198&&b===51&&c===100||a===203&&b===0&&c===113)return false;
  return true;
}
export function articleUrl(raw:string):URL{
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.href.length>500||isIP(u.hostname)||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(u.hostname)||/\.(?:local|localhost|internal|test|invalid|example|onion)$/i.test(u.hostname))throw Error('Invalid public HTTPS URL');
  if(/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com)$/i.test(u.hostname))throw Error('Video link is not an article');
  u.hash='';
  return u;
}
export async function readPublicArticle(raw:string):Promise<string>{
  const u=articleUrl(raw);
  // Resolve once, reject non-public answers, pin the chosen IPv4 for the entire TLS request.
  const resolver=new Resolver({timeout:3000,tries:2});
  const ips=await resolver.resolve4(u.hostname);
  if(!ips.length||ips.some(ip=>!publicIpv4(ip)))throw Error('Non-public DNS answer');
  const html=await new Promise<string>((ok,fail)=>{
    const req=https.request({hostname:ips[0],servername:u.hostname,port:443,path:u.pathname+u.search,method:'GET',agent:false,checkServerIdentity:(_,cert)=>checkServerIdentity(u.hostname,cert),headers:{Host:u.host,Accept:'text/html,text/plain','Accept-Encoding':'identity','User-Agent':'Kodexa-Academy/1.0'}},res=>{
      const type=String(res.headers['content-type']??'');
      const encoding=String(res.headers['content-encoding']??'identity');
      if(res.statusCode!==200||!/^text\/(html|plain)(?:;|$)/i.test(type)||encoding!=='identity'||Number(res.headers['content-length']??0)>MAX){res.destroy();fail(Error('Unsupported article response'));return;}
      const chunks:Buffer[]=[];let size=0;
      res.on('data',(b:Buffer)=>{size+=b.length;if(size>MAX){res.destroy(Error('Article too large'));return;}chunks.push(b);});
      res.on('end',()=>ok(Buffer.concat(chunks).toString('utf8')));
      res.on('error',fail);
      res.on('aborted',()=>fail(Error('Article response aborted')));
    });
    const timer=setTimeout(()=>req.destroy(Error('Article timeout')),20000);timer.unref();
    req.on('close',()=>clearTimeout(timer));req.on('error',fail);req.end();
  });
  const text=documentExcerpt(html);
  if(text.length<100)throw Error('Article content unavailable');
  return text;
}
