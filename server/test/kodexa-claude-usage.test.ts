import {describe,it,expect} from 'vitest';
import {join} from 'node:path';
import {captureAccount,captureMethod} from '../../scripts/kodexa-claude-usage';
describe('ativação da captura original do Claude',()=>{
  it('escolhe o mod somente em versões compatíveis',()=>{
    expect(captureMethod('2.1.287 (Claude Code)')).toBe('mod');
    expect(captureMethod('2.1.286')).toBe('statusline');
    expect(()=>captureMethod('desconhecida')).toThrow();
  });
  it('seleciona somente a conta corrente',()=>{
    const home=process.cwd();
    expect(captureAccount({},home)).toBe(join(home,'.claude'));
    expect(captureAccount({CLAUDE_CONFIG_DIR:'~/.claude-trabalho'},home)).toBe(join(home,'.claude-trabalho'));
  });
});
