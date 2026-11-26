import {describe,it,expect} from 'vitest';
import {tempDir} from '../test/fixtures';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DemoRuntime,verifiedDemo} from './runtime';
describe('verified demo runtime',()=>{
 it('fails closed for arbitrary generated Python, even if it looks like the known app',async()=>{
  const tmp=tempDir();try{
   writeFileSync(join(tmp.dir,'app.py'),'print("do not execute")');
   expect(()=>verifiedDemo(tmp.dir)).toThrow();
   const r=new DemoRuntime(tmp.dir,{KODEXA_RUNTIME_ENABLED:'1',CODESPACE_NAME:'example',GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'app.github.dev'});
   expect(r.status('test',tmp.dir)).toMatchObject({available:false,codespaceOrigin:'https://example-4748.app.github.dev'});
   await expect(r.start('test',tmp.dir)).rejects.toThrow();
  }finally{tmp.cleanup();}
 });
 it('requires opt-in and valid Codespaces environment',async()=>{
  const tmp=tempDir();try{
   const r=new DemoRuntime(tmp.dir,{});
   expect(r.status('test',tmp.dir).available).toBe(false);
   await expect(r.start('test',tmp.dir)).rejects.toThrow();
  }finally{tmp.cleanup();}
 });
});
