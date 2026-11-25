import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
const MAX_BYTES=20*1024*1024;
const MAX_FILES=2000;
const MAX_ENTRIES=10000;
const SKIP_DIR=new Set(['.git','node_modules','.codex','.claude','.ssh','.aws','.venv','__pycache__']);
const skip=(name:string)=>SKIP_DIR.has(name.toLowerCase())||/^\.env(?:\.|$)/i.test(name)||/^(?:auth|credentials|secrets|owner-login)\.json$/i.test(name)||/\.(?:pem|key|p12|pfx)$/i.test(name);
const safeName=(name:string)=>name.length>0&&name!=='..'&&name!=='.'&&!/[\\/:*?"<>|\u0000-\u001f]/.test(name)&&!/[. ]$/.test(name)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
const table=Uint32Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes:Buffer){let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
/** Store-only ZIP; skips symbolic links, hard links, known credential paths and dependency caches. */
export function workspaceZip(root:string):Buffer{
  const base=realpathSync(root);
  const chunks:Buffer[]=[],central:Buffer[]=[];
  let offset=0,total=0,count=0,entries=0;
  function walk(dir:string,rel:string,depth:number){
    if(depth>40)throw Error('Archive depth exceeded');
    for(const name of readdirSync(dir).sort()){
      if(++entries>MAX_ENTRIES)throw Error('Archive entries exceeded');
      if(skip(name)||!safeName(name))continue;
      const path=join(dir,name),relative=rel?rel+'/'+name:name;
      if(Buffer.byteLength(relative)>1024)continue;
      const st=lstatSync(path);
      if(st.isSymbolicLink()||realpathSync(path)!==path)continue;
      if(st.isDirectory()){walk(path,relative,depth+1);continue;}
      if(!st.isFile()||st.nlink!==1)continue;
      if(count>=MAX_FILES||st.size>MAX_BYTES-total)throw Error('Archive limit exceeded');
      const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      let bytes:Buffer;
      try{
        const actual=fstatSync(fd);
        if(!actual.isFile()||actual.nlink!==1||actual.dev!==st.dev||actual.ino!==st.ino||actual.size>MAX_BYTES-total)throw Error('File changed during export');
        bytes=Buffer.alloc(actual.size);
        let pos=0;while(pos<bytes.length){const n=readSync(fd,bytes,pos,bytes.length-pos,pos);if(!n)throw Error('File changed during export');pos+=n;}
      }finally{closeSync(fd);}
      total+=bytes.length;
      const filename=Buffer.from(relative,'utf8'),crc=crc32(bytes);
      const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(33,12);
      local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(filename.length,26);
      const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(33,14);
      c.writeUInt32LE(crc,16);c.writeUInt32LE(bytes.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);
      chunks.push(local,filename,bytes);central.push(c,filename);offset+=local.length+filename.length+bytes.length;count++;
    }
  }
  walk(base,'',0);
  if(!count)throw Error('No exportable files');
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(central.reduce((n,b)=>n+b.length,0),12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,...central,end]);
}
