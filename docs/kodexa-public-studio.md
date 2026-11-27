# Kodexa público

O serviço público tem processo próprio e oferece cadastro com Google, projetos privados e planejamento com as IAs de cada conta. Os projetos são persistidos no diretório público.

## IA no computador do cliente (Kodexa Conector)

É o jeito do Habblaud original: a IA roda no computador do cliente, com o Codex (logado na conta do ChatGPT) ou o
Claude Code (logado na conta Claude) dele, sem chave e sem custo de API. O servidor público só guarda a fila.

1. Em **Configurar estúdio › Conexões e limites das IAs**, a pessoa escolhe “Codex no seu computador” e gera um código
   de pareamento (10 minutos, uso único).
2. No computador dela, com Node.js 20+ e o Codex instalado e logado (`codex login`):
   `curl -fsSL <origem>/public/kodexa-conector.mjs -o kodexa-conector.mjs` e
   `node kodexa-conector.mjs --codigo <código>` (`--com-claude` liga também o Claude Code).
3. O conector guarda um token só daquele computador em `~/.kodexa/conector.json` (o servidor guarda só o hash, em
   `connector-devices.json`) e passa a perguntar por tarefas (`/public/connector/poll`, sempre de saída), roda
   `codex exec --sandbox read-only --ephemeral` (ou `claude -p --permission-mode dontAsk`) numa pasta vazia em
   `~/.kodexa/trabalho` e devolve o texto (`/public/connector/ack`).
4. O computador precisa estar ligado com o conector aberto. Desligado, a etapa não começa e o painel diz isso;
   **Remover** no painel invalida o token na hora.

As tarefas são de planejamento (texto). Nada é editado nem executado no computador do cliente. O uso do Claude Code
automatizado por outro programa pode estar sujeito aos termos do plano Claude; por isso ele só entra com `--com-claude`.

## Credenciais e escolhas

As IAs de cada conta ficam em duas partes, sempre isoladas por usuário (`<diretório>/<usuário>/`):

- **Escolhas** (`ai-routing.json`): IA padrão da conta e IA de cada agente. Não têm segredo e sobrevivem a reinícios e à expiração de uma autorização; o painel pede reconexão em vez de esquecer a escolha. A escolha por projeto fica em `<projeto>.team.json`.
- **Credenciais** (`ai-credentials.enc`): chaves de API e tokens do ChatGPT. Com `KODEXA_CREDENTIALS_KEY`, ficam cifradas (AES-256-GCM, amarradas à conta) e sobrevivem a reinícios. Sem ela, ficam só em memória: somem ao sair da última sessão ou ao reiniciar. Nunca vão ao navegador, a logs, ao Git nem ao JSON dos projetos.

Precedência da IA de uma etapa: escolha do agente no projeto → IA padrão do projeto → atribuição do agente na conta → IA padrão da conta. Uma IA desconectada, expirada ou sem cota interrompe só a etapa afetada (resultados anteriores ficam), sem trocar de conta, provedor ou cobrança; reconectar retoma.

## Validar antes de abrir o acesso

1. Escolha um hostname HTTPS dedicado. Mantenha a rota e a política de acesso do proprietário. No proxy, preserve o cabeçalho Host do endereço público e encaminhe apenas esse hostname para o novo serviço.
2. Crie um cliente OAuth para aplicação web no Google Cloud. Cadastre a URI exata formada pela origem pública mais `/public/google/callback`. Durante a validação, restrinja o cliente às contas de teste.
3. Configure as quatro variáveis no ambiente do serviço. Mantenha o segredo OAuth no gerenciador de segredos e use um diretório persistente exclusivo, fora do repositório e separado dos dados do proprietário.
4. Compile e inicie o processo público. Ele escuta em `127.0.0.1:4750`. O processo do proprietário pode continuar na porta e no hostname atuais.

| Variável | Valor |
| --- | --- |
| `KODEXA_PUBLIC_ORIGIN` | Origem HTTPS do hostname público, sem barra final |
| `KODEXA_PUBLIC_DATA_DIR` | Caminho absoluto do armazenamento público |
| `KODEXA_GOOGLE_CLIENT_ID` | Identificador do cliente OAuth web |
| `KODEXA_GOOGLE_CLIENT_SECRET` | Segredo desse cliente OAuth |
| `KODEXA_CREDENTIALS_KEY` | Opcional. 32 bytes em base64 (`openssl rand -base64 32`), no gerenciador de segredos. Guarda as conexões de IA entre reinícios. Trocar ou perder a chave desconecta todas as IAs (os clientes reconectam). |
| `KODEXA_CHATGPT_CLIENT_ID` | Só depois da liberação da OpenAI para uso do plano ChatGPT em site hospedado. Sem ele, o painel mostra “Aguardando liberação da OpenAI”. |
| `KODEXA_CHATGPT_CLIENT_SECRET` | Só se a OpenAI emitir segredo para esse cliente (enviado em `client_secret_basic`). |
| `KODEXA_CHATGPT_MODEL` | Modelo liberado para o uso do plano (os nomes mudam; use o que a OpenAI indicar). Obrigatório junto com o client id. |

Ao receber a liberação do ChatGPT, cadastre na OpenAI o retorno exato `<KODEXA_PUBLIC_ORIGIN>/public/chatgpt/callback`. O fluxo implementado segue a documentação pública (developers.openai.com/siwc): Authorization Code com PKCE S256, `state` e `nonce`, escopos `openid email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`, ID token conferido pelas chaves publicadas, renovação com troca do refresh token e revogação ao desconectar. A documentação pública cobre apps locais; confira com a OpenAI se os parâmetros do site hospedado são os mesmos antes de ativar.

```sh
npm ci
npm run typecheck
npm run build:server
npm run start:public
```

A página fica em `/public/`. Confira `/public/health` e verifique que `/public/projects` retorna 401 sem sessão. Use dois perfis de navegador com contas Google diferentes. Na primeira conta, crie um projeto, conecte uma IA de teste e execute uma etapa com autorização de consumo. Na segunda, confirme que esse projeto e essa IA não aparecem. Volte à primeira conta, encerre a sessão e confirme que o acesso aos projetos exige novo login. Confira também que o painel privado do proprietário continua exigindo sua própria sessão.

O serviço público atual oferece planejamento. A execução de código, os terminais do proprietário, o runtime de prévia e os arquivos do Codespace permanecem fora das rotas públicas.
