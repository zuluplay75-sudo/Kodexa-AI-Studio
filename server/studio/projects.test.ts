import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectStudio } from './projects';
import { STAGES } from '../../shared/studio-project';
const dirs:string[]=[];
function dir(){const d=mkdtempSync(join(tmpdir(),'kodexa-studio-'));dirs.push(d);return d;}
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
describe('project studio',()=>{
  it('requires approval, runs each role in order and persists real outputs',async()=>{
    const d=dir(),run=vi.fn(async(_p:unknown,s:typeof STAGES[number])=>({text:s[0],sources:[]}));
    const s=new ProjectStudio({dir:d,env:{},run});
    const p=s.create({brief:'Criar aplicativo de oficina',research:false});
    await expect(s.next(p.id)).resolves.toMatchObject({state:'approval'});
    await expect(s.next(p.id)).rejects.toMatchObject({status:409});
    s.approve(p.id,'Aplicativo de orçamento');
    for(let i=1;i<STAGES.length;i++)await s.next(p.id);
    expect(run.mock.calls.map(x=>x[1][0])).toEqual(STAGES.map(x=>x[0]));
    expect(new ProjectStudio({dir:d,env:{}}).info().projects[0]).toMatchObject({state:'complete',decision:'Aplicativo de orçamento'});
  });
  it('launches a background batch only after approval and rejects simultaneous jobs',async()=>{
    const s=new ProjectStudio({dir:dir(),env:{},run:async(_p,stage)=>({text:stage[0],sources:[]})});
    const p=s.create({brief:'Criar aplicativo de oficina',research:false});
    expect(()=>s.launch(p.id,true)).toThrow();
    expect(s.launch(p.id).state).toBe('running');
    expect(()=>s.launch(p.id)).toThrow();
    await vi.waitFor(()=>expect(s.info().projects[0].state).toBe('approval'));
    s.approve(p.id,'Aplicativo de oficina');
    expect(s.launch(p.id,true).state).toBe('running');
    await vi.waitFor(()=>expect(s.info().projects[0].state).toBe('complete'));
  });
  it('executes independent roles in parallel, preserves successful siblings and retries only missing work',async()=>{
    const releases=new Map<string,()=>void>();const calls:string[]=[];let fail=true;
    const studio=new ProjectStudio({dir:dir(),env:{},run:async(_p,s)=>{
      const role=s[0];calls.push(role);
      if(['academy','design','network'].includes(role)&&fail){
        await new Promise<void>(resolve=>releases.set(role,resolve));
        if(role==='design')throw Error('temporary failure');
      }
      return {text:role,sources:[]};
    }});
    const p=studio.create({brief:'Criar aplicativo de oficina',research:false});
    await studio.next(p.id);studio.approve(p.id,'Aplicativo de oficina');studio.launch(p.id,true);
    await vi.waitFor(()=>expect(releases.size).toBe(3));
    expect(studio.info().projects[0].runningRoles).toEqual(['academy','design','network']);
    expect(calls).not.toContain('dev');
    releases.get('network')!();releases.get('design')!();releases.get('academy')!();
    await vi.waitFor(()=>expect(studio.info().projects[0].state).toBe('failed'));
    expect(studio.info().projects[0].stages.map(s=>s.role)).toEqual(['scout','manager','academy','network']);
    fail=false;studio.launch(p.id,true);
    await vi.waitFor(()=>expect(studio.info().projects[0].state).toBe('complete'));
    expect(calls.filter(r=>r==='academy')).toHaveLength(1);expect(calls.filter(r=>r==='network')).toHaveLength(1);expect(calls.filter(r=>r==='design')).toHaveLength(2);
    expect(studio.info().projects[0].stages.map(s=>s.role)).toEqual(STAGES.map(s=>s[0]));
  });
  it('accepts a configured CLI planning runner without API credentials and does not claim web research',async()=>{
    const planner=vi.fn(async(_workspace:string,_prompt:string)=>'Plano CLI');
    const s=new ProjectStudio({dir:dir(),env:{KODEXA_STUDIO_PROVIDER:'codex-cli'},planner});
    expect(s.info()).toMatchObject({configured:true,webResearch:false,provider:'codex-cli'});
    expect(()=>s.create({brief:'Criar aplicativo de oficina',research:true})).toThrow();
    const p=s.create({brief:'Criar aplicativo de oficina',research:false});
    expect((await s.next(p.id)).state).toBe('approval');
    expect(planner).toHaveBeenCalledWith(expect.stringContaining(p.id),expect.stringContaining('Kodexa Scout'));
  });
  it('requires a completed plan and explicit execution approval, then runs three real-runner jobs in one workspace',async()=>{
    const d=dir(),execute=vi.fn(async(job:import('./execution').ExecutionJob)=>job.role+' report');
    const s=new ProjectStudio({dir:d,env:{},run:async(_p,stage)=>({text:stage[0],sources:[]}),execute});
    const p=s.create({brief:'Criar aplicativo de oficina',research:false});
    expect(()=>s.deliver(p.id,true)).toThrow();
    await s.next(p.id);s.approve(p.id,'Aplicativo de oficina');
    for(let i=1;i<STAGES.length;i++)await s.next(p.id);
    expect(()=>s.deliver(p.id,false)).toThrow();
    expect(s.deliver(p.id,true).delivery?.state).toBe('running');
    expect(()=>s.deliver(p.id,true)).toThrow();
    await vi.waitFor(()=>expect(s.info().projects[0].delivery?.state).toBe('review'));
    expect(execute.mock.calls.map(c=>c[0].role)).toEqual(['dev','qa','shield']);
    expect(new Set(execute.mock.calls.map(c=>c[0].workspace)).size).toBe(1);
    expect(new ProjectStudio({dir:d,env:{}}).info().projects[0].delivery?.steps).toHaveLength(3);
  });
  it('does not invent execution when provider unavailable or fails',async()=>{
    const s=new ProjectStudio({dir:dir(),env:{}});
    const p=s.create({brief:'Criar aplicativo de oficina',research:false});
    await expect(s.next(p.id)).rejects.toMatchObject({status:409});
    expect(s.info().projects[0].stages).toEqual([]);
    const t=new ProjectStudio({dir:dir(),env:{},run:async()=>{throw Error('provider failure');}});
    const q=t.create({brief:'Criar aplicativo de oficina',research:false});
    expect(await t.next(q.id)).toMatchObject({state:'failed',stages:[]});
  });
  it('asks the actual configured endpoint for web research and records citations',async()=>{
    const f=vi.fn(async()=>new Response(JSON.stringify({status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'Pesquisa',annotations:[{type:'url_citation',url:'https://example.org'}]}]}]})));
    const s=new ProjectStudio({dir:dir(),env:{KODEXA_STUDIO_MODEL:'test-model',OPENAI_API_KEY:'test-key'},fetcher:f as typeof fetch});
    const p=s.create({brief:'Pesquisar mercado de jogos',research:true});
    const result=await s.next(p.id);
    expect(result.stages[0].sources).toEqual(['https://example.org']);
    expect(f).toHaveBeenCalledWith('https://api.openai.com/v1/responses',expect.objectContaining({method:'POST'}));
  });
});
