import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {AcademyStudy,knowledgeFor} from './study';
import type {Note} from './bootstrap';
const dirs:string[]=[];const dir=()=>{const d=mkdtempSync(join(tmpdir(),'kodexa-study-'));dirs.push(d);return d;};
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
const env={KODEXA_ACADEMY_AUTO:'1',KODEXA_ACADEMY_MODEL:'test',KODEXA_ACADEMY_PROVIDER:'openai',OPENAI_API_KEY:'fake'};
const note:Note={role:'dev',source:'Manual',kind:'transcript',createdAt:'',text:'Nota de teste',validated:false};
describe('Academy manual study',()=>{
  it('requires consent and studies uploaded media using transcription before notes',async()=>{
    const study=vi.fn(async()=>note);
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({text:'transcrição '.repeat(20)})));
    const s=new AcademyStudy({dir:dir(),env,study,fetcher:fetcher as typeof fetch});
    const input={role:'dev',source:'Vídeo próprio',filename:'video.mp4',media:Buffer.from('fake-media').toString('base64')};
    expect(()=>s.launch(input)).toThrow();
    expect(s.launch({...input,approved:true}).state).toBe('running');
    await vi.waitFor(()=>expect(s.info().jobs[0].state).toBe('done'));
    expect(fetcher).toHaveBeenCalledWith('https://api.openai.com/v1/audio/transcriptions',expect.objectContaining({method:'POST'}));
    expect(study).toHaveBeenCalledWith(expect.anything(),'dev','Vídeo próprio','transcrição '.repeat(20).trim());
  });
  it('reads a public article link before producing notes, rejects mixed inputs',async()=>{
    const study=vi.fn(async()=>note),readArticle=vi.fn(async()=> 'artigo '.repeat(20));
    const s=new AcademyStudy({dir:dir(),env,study,readArticle});
    expect(()=>s.launch({role:'dev',link:'https://127.0.0.1/',approved:true})).toThrow();
    expect(()=>s.launch({role:'dev',link:'https://docs.godotengine.org/',text:'mixed',approved:true})).toThrow();
    s.launch({role:'dev',link:'https://docs.godotengine.org/',approved:true});
    await vi.waitFor(()=>expect(s.info().jobs[0].state).toBe('done'));
    expect(readArticle).toHaveBeenCalledWith('https://docs.godotengine.org/');
    expect(study).toHaveBeenCalledWith(expect.anything(),'dev','https://docs.godotengine.org/','artigo '.repeat(20));
  });
  it('accepts authorized public YouTube videos through Gemini without article or audio API',async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'Nota audiovisual de teste'}]}}]}));
    const s=new AcademyStudy({dir:dir(),env:{KODEXA_ACADEMY_VIDEO:'1',GEMINI_API_KEY:'fake'},fetcher});
    const input={role:'dev',videoProvider:'gemini',link:'https://youtu.be/abcdefghijk'};
    expect(()=>s.launch(input)).toThrow();
    expect(()=>s.launch({...input,link:'https://example.com/video',approved:true})).toThrow();
    expect(s.launch({...input,approved:true})).toMatchObject({kind:'video',videoProvider:'gemini',source:'https://www.youtube.com/watch?v=abcdefghijk'});
    await vi.waitFor(()=>expect(s.info().jobs[0].state).toBe('done'));
    expect(s.info().notes[0]).toMatchObject({kind:'video',role:'dev',validated:false});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('passes only bounded notes for the requested role, as unvalidated',()=>{
    const d=dir();writeFileSync(join(d,'state.json'),JSON.stringify({notes:[note,{...note,role:'qa',text:'Other'}]}));
    expect(knowledgeFor(d,'dev')).toEqual([{source:'Manual',text:'Nota de teste',validated:false}]);
    expect(knowledgeFor(d,'scout')).toEqual([]);
  });
});
