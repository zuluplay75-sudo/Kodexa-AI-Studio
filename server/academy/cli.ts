import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../config';
import { CURRICULUM, runAcademyOnce, studyTranscript, type AcademyState, type Role } from './bootstrap';

const [command = 'status', role, source, path] = process.argv.slice(2);
const dir = join(loadConfig().dataDir, 'academy');
async function main() {
  if (command === 'run') {
    const state = await runAcademyOnce({dir});
    console.log(JSON.stringify({enabled:process.env.KODEXA_ACADEMY_AUTO === '1',jobs:state.jobs,budget:state.budget},null,2));
  } else if (command === 'status' || command === 'notes') {
    const state = JSON.parse(await readFile(join(dir,'state.json'),'utf8')) as AcademyState;
    if (command === 'notes' && role && !CURRICULUM.some(r=>r.id===role)) throw new Error('Cargo inválido');
    console.log(JSON.stringify(command === 'status' ? {jobs:state.jobs,budget:state.budget,notes:state.notes.length} : state.notes.filter(n=>!role || n.role===role),null,2));
  } else if (command === 'transcript') {
    if (!role || !source || !path || !CURRICULUM.some(r=>r.id===role)) throw new Error('Uso: transcript <cargo> <referência> <arquivo-txt-autorizado>');
    const info = await stat(path);
    if (!info.isFile() || info.size > 64000) throw new Error('Use um arquivo de texto de até 64 KB, em segmentos de até 16000 caracteres');
    const transcript = await readFile(path,'utf8');
    const note = await studyTranscript({dir},role as Role,source,transcript);
    console.log(JSON.stringify(note,null,2));
  } else throw new Error('Comandos: run, status, notes [cargo], transcript <cargo> <referência> <arquivo>');
}
main().catch(() => { console.error('Academy: operação recusada ou indisponível. Confira configuração, parâmetros, limite diário e trava de processamento.'); process.exitCode = 1; });
