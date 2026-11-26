import { describe, expect, it } from 'vitest';
import { defaultMembers, parsePrefs } from './prefs';
const base = () => ({schema:1,company:'Minha empresa',theme:'midnight',members:defaultMembers()});
describe('studio preferences',()=>{
  it('provides eight distinct roles without connected accounts',()=>{
    const members=defaultMembers();
    expect(members).toHaveLength(8);
    expect(new Set(members.map(m=>m.id)).size).toBe(8);
    expect(members.every(m=>m.provider==='unconfigured')).toBe(true);
  });
  it('accepts standard, customized and empty teams',()=>{
    expect(parsePrefs(JSON.stringify(base()))?.members).toHaveLength(8);
    expect(parsePrefs(JSON.stringify({...base(),members:[]}))?.members).toHaveLength(0);
    const p=base();p.members[0].provider='codex';p.members[0].name='Pesquisa';
    expect(parsePrefs(JSON.stringify(p))?.members[0].provider).toBe('codex');
    p.members[0].provider='gemini';
    expect(parsePrefs(JSON.stringify(p))?.members[0].provider).toBe('gemini');
  });
  it('rejects invalid, duplicate and oversized entries',()=>{
    expect(parsePrefs('invalid')).toBeNull();
    expect(parsePrefs(JSON.stringify({...base(),company:' '}))).toBeNull();
    const p=base();p.members.push(p.members[0]);
    expect(parsePrefs(JSON.stringify(p))).toBeNull();
    expect(parsePrefs(JSON.stringify({...base(),theme:'unknown'}))).toBeNull();
  });
});
