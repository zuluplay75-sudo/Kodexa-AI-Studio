import {describe,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProviderRouter,claudePlanningArgs} from './providers';
import {STAGES} from '../../shared/studio-project';
describe('multi provider planning',()=>{
 it('sends Gemini key only in headers, counts attempts persistently and never exposes key',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'kodexa-provider-'));
  try{
   const f=vi.fn(async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'hidden'},{text:'OK'}]}}]})));
   const env={GEMINI_API_KEY:'secret-key',KODEXA_GEMINI_MODEL:'gemini-test'};
   const r=new ProviderRouter(dir,env,f as typeof fetch);
   r.configure({roles:Object.fromEntries(STAGES.map(s=>[s[0],'gemini'])),fallback:false,dailyLimit:1});
   expect(await r.call('gemini',dir,'system','input')).toBe('OK');
   expect(f).toHaveBeenCalledWith(expect.stringContaining('/gemini-test:generateContent'),expect.objectContaining({headers:expect.objectContaining({'x-goog-api-key':'secret-key'})}));
   expect(JSON.stringify(r.info())).not.toContain('secret-key');
   expect(readFileSync(join(dir,'providers.json'),'utf8')).not.toContain('secret-key');
   const restarted=new ProviderRouter(dir,env,f as typeof fetch);
   await expect(restarted.call('gemini',dir,'system','input')).rejects.toThrow('Limite diário');
   expect(f).toHaveBeenCalledTimes(1);
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it('disables tools for Claude and never bypasses permissions',()=>{
   const args=claudePlanningArgs('text');expect(args).toContain('--safe-mode');expect(args).toContain('--strict-mcp-config');expect(args[args.indexOf('--tools')+1]).toBe('');expect(args).not.toContain('--dangerously-skip-permissions');
 });
});
