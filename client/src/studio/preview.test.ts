import {describe,it,expect} from 'vitest';
import {privatePortUrl,previewDocument} from './preview';
describe('preview isolation helpers',()=>{
 it('only links another Codespaces port',()=>{
   expect(privatePortUrl('https://my-space-4748.app.github.dev',8000)).toBe('https://my-space-8000.app.github.dev/');
   expect(privatePortUrl('https://my-space-4748.app.github.dev',4747)).toBeUndefined();
   expect(privatePortUrl('https://my-space-4748.app.github.dev',4748)).toBeUndefined();
   expect(privatePortUrl('https://evil.example',8000)).toBeUndefined();
 });
 it('places restrictive policy before generated markup',()=>{
   const source='<script>alert(1)</script>';const doc=previewDocument(source,false);
   expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf(source));
   expect(doc).toContain("script-src 'none'");expect(doc).toContain("connect-src 'none'");expect(doc).toContain("form-action 'none'");
   expect(previewDocument(source,true)).toContain("script-src 'unsafe-inline' data:");
 });
});
