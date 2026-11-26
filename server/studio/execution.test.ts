import { mkdtempSync,rmSync,mkdirSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe,it,expect } from 'vitest';
import { executionArgs,executionEnvironment,projectWorkspace,configuredExecutor,configuredCliPlanner,planningArgs } from './execution';
const id='aa222222-3333-4444-aaaa-123456789abc';
describe('managed executor',()=>{
  it('uses a managed path and rejects traversal and symbolic links',()=>{
    const root=mkdtempSync(join(tmpdir(),'kodexa-exec-'));
    try{
      expect(()=>projectWorkspace(root,'../outside')).toThrow();
      const path=projectWorkspace(root,id);
      expect(path.endsWith(id)).toBe(true);
      rmSync(path,{recursive:true});
      mkdirSync(join(root,'other'));
      symlinkSync(join(root,'other'),path,'dir');
      expect(()=>projectWorkspace(root,id)).toThrow();
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it('requires opt-in and keeps secrets out of subprocess environment',()=>{
    expect(configuredExecutor({})).toBeUndefined();
    expect(configuredCliPlanner({})).toBeUndefined();
    expect(configuredCliPlanner({KODEXA_STUDIO_PROVIDER:'codex-cli',KODEXA_EXEC_CODEX_HOME:'relative'})).toBeUndefined();
    expect(planningArgs('prompt')).toEqual(['-a','never','-c','sandbox_workspace_write.network_access=false','exec','--sandbox','read-only','--skip-git-repo-check','--','prompt']);
    const env=executionEnvironment({HOME:'/home/test',PATH:'/usr/bin',KODEXA_EXEC_CODEX_HOME:'/private/codex',GITHUB_TOKEN:'secret',OPENAI_API_KEY:'secret',HABBLAUD_REMOTE_PASSWORD_HASH:'secret'});
    expect(env).toEqual({HOME:'/home/test',PATH:'/usr/bin',CODEX_HOME:'/private/codex'});
    const args=executionArgs({workspace:'/tmp/project',role:'dev',project:{id,brief:'--dangerously-bypass-approvals-and-sandbox',decision:'app',stages:[],state:'complete',research:false,createdAt:''}});
    expect(args.slice(0,-1)).toEqual(['-a','never','-c','sandbox_workspace_write.network_access=false','exec','--sandbox','workspace-write','--skip-git-repo-check','--']);
    expect(args.at(-1)).toContain('Implemente');
  });
});
