import {describe,it,expect} from 'vitest';
import {tempDir} from '../test/fixtures';
import {join} from 'node:path';
import {mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {readPreview} from './preview';
describe('static preview',()=>{
 it('bundles only local bounded CSS and JS, supports static directory',()=>{
  const tmp=tempDir();try{
   mkdirSync(join(tmp.dir,'static'));
   writeFileSync(join(tmp.dir,'static/index.html'),'<link rel="stylesheet" href="/static/style.css"><script src="app.js"></script><h1>Oficina</h1>');
   writeFileSync(join(tmp.dir,'static/style.css'),'h1{color:red}');
   writeFileSync(join(tmp.dir,'static/app.js'),'document.title="Oficina"');
   const p=readPreview(tmp.dir);expect(p.entry).toBe('static/index.html');expect(p.html).toContain('data:text/css;base64,');expect(p.html).toContain('data:text/javascript;base64,');expect(p.html).toContain('<h1>Oficina</h1>');
  }finally{tmp.cleanup();}
 });
 it('does not read traversal, external resources or symlinks',()=>{
  const tmp=tempDir(),outside=tempDir();try{
   writeFileSync(join(outside.dir,'secret.js'),'PRIVATE_SECRET');
   symlinkSync(join(outside.dir,'secret.js'),join(tmp.dir,'alias.js'));
   writeFileSync(join(tmp.dir,'index.html'),'<script src="alias.js"></script><script src="../secret.js"></script><script src="https://example.com/a.js"></script>');
   const p=readPreview(tmp.dir);expect(p.html).not.toContain('data:text/javascript');expect(p.html).not.toContain('PRIVATE_SECRET');
  }finally{tmp.cleanup();outside.cleanup();}
 });
});
