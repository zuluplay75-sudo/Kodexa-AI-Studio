import { describe,it,expect } from 'vitest';
import { publicIpv4,articleUrl } from './web-source';
describe('public article boundary',()=>{
  it('rejects internal, special and non-IPv4 addresses',()=>{
    for(const ip of ['0.1.2.3','10.1.2.3','127.0.0.1','169.254.169.254','100.64.1.2','172.31.0.1','192.168.0.1','192.0.2.1','198.18.1.1','224.0.0.1','::1','::ffff:127.0.0.1'])expect(publicIpv4(ip),ip).toBe(false);
    expect(publicIpv4('8.8.8.8')).toBe(true);
  });
  it('accepts HTTPS article names, not credentials, internal hosts, video or ports',()=>{
    expect(articleUrl('https://docs.godotengine.org/a#section').href).toBe('https://docs.godotengine.org/a');
    for(const url of ['http://docs.godotengine.org','https://user:secret@docs.godotengine.org','https://127.0.0.1/','https://0x7f000001/','https://metadata.google.internal','https://docs.godotengine.org:8080/','https://www.youtube.com/watch?v=abc'])expect(()=>articleUrl(url),url).toThrow();
  });
});
