import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CURRICULUM, documentExcerpt, runAcademyOnce, studyTranscript } from './bootstrap';

const dirs: string[] = [];
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'kodexa-test-')); dirs.push(dir); return dir; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir,{recursive:true,force:true}))); });
const date = () => new Date('2026-11-25T12:00:00Z');
const env = { KODEXA_ACADEMY_AUTO: '1', KODEXA_ACADEMY_PROVIDER: 'openai', KODEXA_ACADEMY_MODEL: 'test', OPENAI_API_KEY: 'fake', YOUTUBE_API_KEY: 'fake', KODEXA_ACADEMY_DAILY_MODEL_CALLS:'1', KODEXA_ACADEMY_DAILY_VIDEO_SEARCHES:'1' };
function fakeFetch() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.startsWith('https://api.openai.com/')) return Response.json({choices:[{finish_reason:'stop',message:{content:'Notas técnicas de teste.'}}]});
    if (url.startsWith('https://www.googleapis.com/')) return Response.json({items:[{id:{videoId:'abcdefghijk'},snippet:{title:'Tutorial',channelTitle:'Canal'}}]});
    return new Response('<main>'+ 'Texto técnico para análise. '.repeat(40)+'</main>');
  });
}

describe('Kodexa Academy bootstrap', () => {
  it('creates eight pending roles with no external request by default', async () => {
    const dir = await directory(); const fetcher = fakeFetch();
    const state = await runAcademyOnce({dir,env:{},fetcher,now:date});
    expect(state.jobs.map(j => j.role)).toEqual(CURRICULUM.map(r => r.id));
    expect(state.notes).toHaveLength(0); expect(fetcher).not.toHaveBeenCalled();
  });
  it('stores model notes and distinguishes video discovery from learning, respecting budget after restart', async () => {
    const dir = await directory(); const fetcher = fakeFetch();
    const opts = {dir,env,fetcher,now:date};
    const state = await runAcademyOnce(opts);
    expect(state.notes).toHaveLength(1); expect(state.notes[0].validated).toBe(false);
    expect(state.jobs[0].videos[0].status).toBe('discovered');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await runAcademyOnce(opts)).notes).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const tomorrow = await runAcademyOnce({...opts,now:()=>new Date('2026-11-26T12:00:00Z')});
    expect(tomorrow.notes).toHaveLength(2);
    expect(tomorrow.notes[1].role).toBe('academy');
  });
  it('records failures without fabricating notes and moves to unattempted roles the next day', async () => {
    const dir = await directory();
    const fetcher = vi.fn<typeof fetch>(async () => new Response('unavailable',{status:503}));
    const first = await runAcademyOnce({dir,env,fetcher,now:date});
    expect(first.jobs[0].status).toBe('failed'); expect(first.notes).toHaveLength(0);
    const second = await runAcademyOnce({dir,env,fetcher,now:()=>new Date('2026-11-26T12:00:00Z')});
    expect(second.jobs[1].status).toBe('failed'); expect(second.notes).toHaveLength(0);
  });
  it('stores notes for an authorized transcript without fetching its URL', async () => {
    const dir = await directory(); const fetcher = fakeFetch();
    const note = await studyTranscript({dir,env,fetcher,now:date},'design','https://example.com/video','Conteúdo autorizado. '.repeat(15));
    expect(note.kind).toBe('transcript'); expect(note.validated).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.openai.com/v1/chat/completions');
    await expect(studyTranscript({dir,env,fetcher,now:date},'design','video','Conteúdo autorizado. '.repeat(15))).rejects.toThrow('Daily model budget');
  });
  it('does not persist truncated study notes from either provider', async () => {
    for (const provider of ['openai','anthropic'] as const) {
      const dir = await directory();
      const payload = provider === 'openai'
        ? {choices:[{finish_reason:'length',message:{content:'Partial note'}}]}
        : {stop_reason:'max_tokens',content:[{type:'text',text:'Partial note'}]};
      const fetcher = vi.fn<typeof fetch>(async () => Response.json(payload));
      const options = {dir,env:{...env,KODEXA_ACADEMY_PROVIDER:provider,ANTHROPIC_API_KEY:'fake'},fetcher,now:date};
      await expect(studyTranscript(options,'design','Video','Conteúdo autorizado. '.repeat(15))).rejects.toThrow('incomplete model output');
      const {loadAcademy} = await import('./bootstrap');
      const saved = await loadAcademy(dir,'2026-11-25');
      expect(saved.notes).toHaveLength(0);
      expect(saved.budget.modelCalls).toBe(1);
    }
  });
  it('strips scripts and HTML from source excerpts', () => {
    expect(documentExcerpt('<main><script>evil()</script><p>Hello &amp; world</p></main>')).toBe('Hello & world');
  });
});
