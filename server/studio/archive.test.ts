import { mkdtempSync,mkdirSync,rmSync,symlinkSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe,it,expect } from 'vitest';
import { workspaceZip,crc32 } from './archive';
describe('workspace archive',()=>{
  it('writes valid local entries and omits links, secrets and dependency caches',()=>{
    const root=mkdtempSync(join(tmpdir(),'kodexa-zip-'));
    try{
      writeFileSync(join(root,'README.md'),'hello');
      writeFileSync(join(root,'.env'),'secret');
      for(const name of ['.npmrc','.pypirc','.netrc','.git-credentials','id_ed25519','.gitconfig'])writeFileSync(join(root,name),'secret');
      mkdirSync(join(root,'.docker'));writeFileSync(join(root,'.docker','config.json'),'secret');
      mkdirSync(join(root,'node_modules'));writeFileSync(join(root,'node_modules','x'),'secret');
      symlinkSync(join(root,'.env'),join(root,'alias'));
      const zip=workspaceZip(root);
      expect(zip.readUInt32LE(0)).toBe(0x04034b50);
      expect(zip.readUInt32LE(14)).toBe(crc32(Buffer.from('hello')));
      expect(zip.subarray(30,30+zip.readUInt16LE(26)).toString()).toBe('README.md');
      expect(zip.readUInt32LE(zip.length-22)).toBe(0x06054b50);
      expect(zip.readUInt16LE(zip.length-12)).toBe(1);
      expect(zip.includes(Buffer.from('secret'))).toBe(false);
      expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});
