// Ativação explícita e local do mecanismo original de captura do Claude Code.
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expandHome, isCodexHome } from '../server/accounts/detect';
import { makeClaudeRunner, parseVersion, versionAtLeast, MIN_CLAUDE_VERSION, readPackageVersion, run as runMod } from './mod-install';
import { TAP_SCRIPT, run as runTap } from './statusline-install';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function captureMethod(version:string):'mod'|'statusline'{
  if(!parseVersion(version))throw Error('Não foi possível reconhecer a versão do Claude Code.');
  return versionAtLeast(version,MIN_CLAUDE_VERSION)?'mod':'statusline';
}
export function captureAccount(env:NodeJS.ProcessEnv,home:string):string{
  const dir=env.CLAUDE_CONFIG_DIR?.trim();
  return dir?expandHome(dir,home):join(home,'.claude');
}
async function main(){
  const args=process.argv.slice(2);
  if(args.some(a=>a!=='--dry-run'))throw Error('Uso: npm run usage:claude -- [--dry-run]');
  const dryRun=args.includes('--dry-run'),home=process.env.HOME||homedir();
  const account=captureAccount(process.env,home);
  if(!statSync(account,{throwIfNoEntry:false})?.isDirectory()||isCodexHome(account))throw Error('Conta Claude não encontrada. Abra e autentique o Claude Code primeiro.');
  const claude=makeClaudeRunner(),version=claude(['--version'],process.env);
  if(version.code!==0||version.error)throw Error('Não foi possível executar Claude Code. Confira a instalação.');
  const method=captureMethod(version.stdout);
  const env={...process.env,HABBLAUD_CLAUDE_DIRS:account};
  const now=new Date(),out=(line:string)=>console.log(line);
  out('Captura original do Claude: '+method+' · '+account+(dryRun?' (simulação)':''));
  const code=method==='mod'
    ?await runMod({command:'install',dryRun,permissions:false,messages:false,accounts:[account]},{env,home,now,root:ROOT,version:readPackageVersion(ROOT),claude,out})
    :runTap({command:'install',dryRun},{env,home,now,tapPath:TAP_SCRIPT,out});
  process.exitCode=code;
  if(code===0&&!dryRun)out('Instalador concluído. Abra uma sessão do Claude e envie uma mensagem; se necessário, recarregue os plugins. A captura de percentuais ainda depende dos dados reais do Claude.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Falha ao ativar captura.');process.exitCode=1;});
}
