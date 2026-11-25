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
