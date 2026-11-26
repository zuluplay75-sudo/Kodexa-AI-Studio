// Convert user-authorized local subtitles to plain transcript; never fetch a video.
export function subtitleTranscript(raw:string):string{
 const lines=raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n');
 const out:string[]=[];
 let cue=false,skip=false;
 const timestamp=/^(?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3}(?:\s|$)/;
 for(const source of lines){
  const line=source.trim();
  if(!line){cue=false;skip=false;continue;}
  if(!cue&&/^(?:WEBVTT(?:\s|$)|NOTE(?:\s|$)|STYLE$|REGION$)/.test(line)){skip=true;continue;}
  if(skip)continue;
  if(timestamp.test(line)){cue=true;continue;}
  if(!cue)continue;
  const text=line.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
  if(text&&out.at(-1)!==text)out.push(text);
 }
 const result=out.join('\n');
 if(result.length<100||result.length>16000)throw Error('A legenda deve gerar uma transcrição de 100–16000 caracteres. Divida arquivos longos.');
 return result;
}
