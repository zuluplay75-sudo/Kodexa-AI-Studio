import {describe,it,expect} from 'vitest';
import {subtitleTranscript} from './subtitles';
const line='Explicação técnica autorizada para estudo e planejamento dos agentes do Kodexa.';
const second='Um segundo trecho explica os requisitos, os testes e a revisão das funcionalidades.';
describe('local subtitle conversion',()=>{
 it('strips SRT cue metadata, formatting and immediate duplicates',()=>{
  const raw='\uFEFF1\r\n00:00:00,000 --> 00:00:04,000\r\n<i>'+line+'</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:08,000\r\n'+line+'\r\n'+second;
  expect(subtitleTranscript(raw)).toBe(line+'\n'+second);
 });
 it('skips WebVTT comments, style blocks, identifiers and timing settings',()=>{
  const raw='WEBVTT\n\nNOTE private metadata\nignore me\n\nSTYLE\n::cue { color: white; }\n\nintro\n00:00.000 --> 00:05.000 align:start\n'+line+'\n\n00:05.000 --> 00:10.000\n'+second;
  expect(subtitleTranscript(raw)).toBe(line+'\n'+second);
 });
 it('rejects missing cues, short and oversized transcripts',()=>{
  expect(()=>subtitleTranscript('plain text '.repeat(100))).toThrow();
  expect(()=>subtitleTranscript('00:00.000 --> 00:01.000\nshort')).toThrow();
  expect(()=>subtitleTranscript('00:00.000 --> 00:01.000\n'+line.repeat(300))).toThrow();
 });
});
