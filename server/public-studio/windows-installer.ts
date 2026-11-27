// Instalador do Kodexa Conector para Windows: um .cmd gerado na hora, com o código de pareamento da conta (10 min,
// uso único). Dois cliques: confere o Node.js, instala o Codex se faltar (npm), pede o login do ChatGPT se precisar
// (codex login, que abre o navegador), baixa o conector do próprio Kodexa, oferece abrir junto com o Windows e pareia.
// Só ASCII e CRLF (o cmd lê o arquivo na página de código do sistema); nenhum segredo vai no arquivo além do código
// de uso único. Tudo fica em %LOCALAPPDATA%\Kodexa; o atalho de inicialização é opcional e pode ser apagado.

/** Só os caracteres que o código e a origem podem ter: nada que o cmd interprete (%, ^, &, |, <, >, aspas). */
function safe(value: string, pattern: RegExp): string {
  if (!pattern.test(value)) throw new Error('Valor inválido para o instalador.');
  return value;
}

export function windowsInstaller(server: string, code: string): string {
  const origin = safe(server, /^https:\/\/[a-z0-9.-]+(:\d+)?$/);
  const pairing = safe(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const lines = [
    '@echo off',
    'setlocal',
    'title Kodexa Conector',
    'echo.',
    'echo  ==== Kodexa Conector ====',
    'echo  Os agentes do Kodexa vao usar o Codex deste computador, com a sua conta do ChatGPT.',
    'echo  Sem chave de API. Este computador precisa ficar ligado com o conector aberto.',
    'echo.',
    `set "KODEXA_SERVER=${origin}"`,
    `set "KODEXA_CODE=${pairing}"`,
    'set "KODEXA_DIR=%LOCALAPPDATA%\\Kodexa"',
    '',
    'rem 1. Node.js',
    'where node >nul 2>nul',
    'if errorlevel 1 goto :sem_node',
    '',
    'rem 2. Codex (instala pelo npm se faltar)',
    'where codex >nul 2>nul',
    'if errorlevel 1 (',
    '  echo  Instalando o Codex...',
    '  call npm install -g @openai/codex',
    '  if errorlevel 1 goto :falha_codex',
    ')',
    '',
    'rem 3. Login do Codex com a conta do ChatGPT (abre o navegador)',
    'call codex login status >nul 2>nul',
    'if errorlevel 1 (',
    '  echo  Entre na sua conta do ChatGPT na janela do navegador que vai abrir.',
    '  call codex login',
    '  if errorlevel 1 goto :falha_login',
    ')',
    '',
    'rem 4. Conector do Kodexa',
    'if not exist "%KODEXA_DIR%" mkdir "%KODEXA_DIR%"',
    'curl.exe -fsSL "%KODEXA_SERVER%/public/kodexa-conector.mjs" -o "%KODEXA_DIR%\\kodexa-conector.mjs"',
    'if errorlevel 1 goto :falha_download',
    '',
    'rem 5. Abrir junto com o Windows (opcional)',
    'choice /C SN /M " Abrir o Kodexa Conector automaticamente quando o Windows iniciar"',
    'if errorlevel 2 goto :parear',
    'set "KODEXA_STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Kodexa Conector.cmd"',
    '> "%KODEXA_STARTUP%" echo @echo off',
    '>> "%KODEXA_STARTUP%" echo start "Kodexa Conector" /min node "%KODEXA_DIR%\\kodexa-conector.mjs"',
    'echo  Pronto: o conector vai abrir minimizado quando o Windows iniciar.',
    'echo  Para desfazer, apague "%KODEXA_STARTUP%".',
    '',
    ':parear',
    'echo.',
    'echo  Pareando este computador com a sua conta do Kodexa...',
    'node "%KODEXA_DIR%\\kodexa-conector.mjs" --codigo %KODEXA_CODE% --nome "%COMPUTERNAME%"',
    'echo.',
    'echo  O conector parou. Para abrir de novo: node "%KODEXA_DIR%\\kodexa-conector.mjs"',
    'pause',
    'exit /b 0',
    '',
    ':sem_node',
    'echo  O Node.js nao foi encontrado. Vou abrir a pagina de download: instale a versao LTS',
    'echo  e depois abra este instalador de novo (o codigo vale por 10 minutos; se vencer, gere outro no Kodexa).',
    'start "" "https://nodejs.org/pt/download"',
    'pause',
    'exit /b 1',
    ':falha_codex',
    'echo  Nao foi possivel instalar o Codex. Rode "npm install -g @openai/codex" e abra este instalador de novo.',
    'pause',
    'exit /b 1',
    ':falha_login',
    'echo  O login do Codex nao foi concluido. Rode "codex login" e abra este instalador de novo.',
    'pause',
    'exit /b 1',
    ':falha_download',
    'echo  Nao foi possivel baixar o conector do Kodexa. Confira a internet e tente de novo.',
    'pause',
    'exit /b 1',
  ];
  return lines.join('\r\n') + '\r\n';
}
