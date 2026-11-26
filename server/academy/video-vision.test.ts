import {describe,it,expect} from 'vitest';
import {visionBlocks,videoArguments,claudeVisionMessage,claudeVisionResult,visionEnabled} from './video-vision';
const response={content:[{type:'text',text:'## Video Metadata\n{}\n## Audio Analysis\n{}'},{type:'text',text:'### Frame at 00:00:02'},{type:'image',mimeType:'image/jpeg',data:'YWJj'}]};
describe('Academy audiovisual bridge',()=>{
 it('passes actual frame bytes alongside timestamps, and never requests arbitrary tools',()=>{
  const blocks=visionBlocks(response);
  const message=JSON.parse(claudeVisionMessage('dev',blocks));
  expect(message.message.content.at(-1)).toEqual({type:'image',source:{type:'base64',media_type:'image/jpeg',data:'YWJj'}});
  expect(videoArguments('/tmp/source.mp4')).toMatchObject({path:'/tmp/source.mp4',end_time:'00:00:30',view_sample:15,skip_audio:false});
 });
 it('rejects missing images, missing metadata, error responses and oversized frame counts',()=>{
  expect(()=>visionBlocks({content:response.content.slice(0,2)})).toThrow();
  expect(()=>visionBlocks({content:response.content.slice(1)})).toThrow();
  expect(()=>visionBlocks({...response,isError:true})).toThrow();
  expect(()=>visionBlocks({content:[response.content[0],...Array(16).fill(response.content[2])]})).toThrow();
 });
 it('accepts a completed Claude result and fails closed on partial results',()=>{
  const event={type:'result',subtype:'success',is_error:false,stop_reason:'end_turn',result:'Nota audiovisual'};
  expect(claudeVisionResult(JSON.stringify({type:'system'})+'\n'+JSON.stringify(event))).toBe('Nota audiovisual');
  expect(()=>claudeVisionResult(JSON.stringify({...event,stop_reason:'max_tokens'}))).toThrow();
  expect(()=>claudeVisionResult(JSON.stringify({...event,is_error:true}))).toThrow();
  expect(visionEnabled({})).toBe(false);
 });
});
