import {describe,it,expect,vi} from 'vitest';
import {geminiVideo,geminiVideoEnabled,youtubeVideoUrl} from './gemini-video';
const env={KODEXA_ACADEMY_VIDEO:'1',GEMINI_API_KEY:'fake-key'};
const url='https://www.youtube.com/watch?v=abcdefghijk';
describe('Gemini Academy video',()=>{
 it('normalizes approved YouTube hostnames and rejects arbitrary URLs',()=>{
  expect(youtubeVideoUrl('https://youtu.be/abcdefghijk?t=3')).toBe(url);
  expect(youtubeVideoUrl('https://www.youtube.com/shorts/abcdefghijk')).toBe(url);
  for(const x of ['http://youtu.be/abcdefghijk','https://youtube.com.evil.test/watch?v=abcdefghijk','https://127.0.0.1/','https://user@youtube.com/watch?v=abcdefghijk','https://youtube.com/watch?v=abcdefghijk&v=zzzzzzzzzzz'])expect(()=>youtubeVideoUrl(x)).toThrow();
 });
 it('uses a fixed Google endpoint, keeps the key in headers, and submits a video part',async()=>{
  const f=vi.fn<typeof fetch>(async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'hidden'},{text:'Notas técnicas'}]}}]}));
  const result=await geminiVideo(env,'dev',{url},f);
  expect(result).toContain('Notas técnicas');expect(result).not.toContain('hidden');
  const [endpoint,init]=f.mock.calls[0];
  expect(String(endpoint)).toContain('https://generativelanguage.googleapis.com/');
  expect(String(endpoint)).not.toContain('fake-key');
  expect(init?.headers).toMatchObject({'x-goog-api-key':'fake-key'});
  expect(JSON.parse(String(init?.body)).contents[0].parts[1]).toMatchObject({fileData:{fileUri:url},videoMetadata:{endOffset:'300s'}});
  await geminiVideo(env,'dev',{bytes:Buffer.from('test'),filename:'source.mp4'},f);
  expect(JSON.parse(String(f.mock.calls[1][1]?.body)).contents[0].parts[1].inlineData).toEqual({mimeType:'video/mp4',data:'dGVzdA=='});
 });
 it('fails closed on incomplete notes and when disabled',async()=>{
  expect(geminiVideoEnabled({})).toBe(false);
  const f=vi.fn<typeof fetch>(async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'partial'}]}}]}));
  await expect(geminiVideo(env,'dev',{url},f)).rejects.toThrow('incomplete');
 });
});
