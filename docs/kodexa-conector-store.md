# Kodexa Conector na Microsoft Store

O Kodexa Conector é o programa que faz os agentes do Kodexa usarem o Codex do computador do cliente (a conta do
ChatGPT dele), como no Habblaud original. Para Windows ele sai em dois formatos:

- **`KodexaConector.exe`**: executável único (Node SEA, `scripts/build-connector-exe.mjs`). Roda sem instalar o Node
  (o Codex do npm ainda precisa do Node, que vem com ele). Sem certificado, o Windows mostra o aviso de app não
  reconhecido.
- **`KodexaConector.msix`**: o mesmo executável empacotado para a **Microsoft Store**, que assina o pacote com o
  certificado da Microsoft (sem custo e sem certificado próprio). Abre junto com o Windows e tem o comando
  `kodexa-conector` no terminal.

Os dois são gerados pelo workflow **Kodexa Conector (Windows)** (`.github/workflows/conector-windows.yml`), que roda num
Windows de verdade e testa o `.exe`, a busca do Codex instalado pelo npm e a instalação do MSIX. Os arquivos ficam nos
artefatos da execução (aba Actions › a execução › Artifacts › `kodexa-conector-windows`).

## Primeira vez do cliente

1. Instala o Codex e entra com a conta do ChatGPT (`npm install -g @openai/codex` e `codex login`).
2. Abre o Kodexa Conector. Ele mostra um código de 4 letras e abre o navegador em “Autorizar este computador?”.
3. Entra com Google no Kodexa (se ainda não estiver), confere o código e clica em **Autorizar este computador**.
4. Pronto: o painel mostra o computador como ligado, e as etapas dos projetos rodam no Codex dele.

Nada de código para copiar. O pareamento fica salvo em `%USERPROFILE%\.kodexa\conector.json`; **Remover** em
Configurar estúdio desliga o computador na hora, e `kodexa-conector --esquecer` apaga o pareamento local.

## Publicar na Microsoft Store (feito pelo responsável, com os dados da empresa)

1. **Conta de desenvolvedor** (gratuita para pessoa física e para empresa): `https://storedeveloper.microsoft.com`.
   Se o Kodexa for uma empresa, crie a conta como **empresa** desde o início (não dá para trocar depois).
2. No **Partner Center**, crie um app e **reserve o nome** “Kodexa Conector”.
3. Em **Gerenciamento de produto › Identidade do produto**, copie:
   - `Package/Identity/Name` (ex.: `12345Kodexa.KodexaConector`)
   - `Package/Identity/Publisher` (ex.: `CN=ABCDEF12-3456-...`)
   - `Package/Properties/PublisherDisplayName`
4. No GitHub: **Actions › Kodexa Conector (Windows) › Run workflow**, na branch do conector, preenchendo os três campos
   com esses valores. Baixe o artefato `kodexa-conector-windows` e use o `KodexaConector.msix` dele.
5. No Partner Center, crie o **envio** do app:
   - **Pacotes**: envie o `KodexaConector.msix` (sem assinatura; a Store assina).
   - **Propriedades**: categoria Produtividade (ou Ferramentas de desenvolvedor); declare que o app **depende de
     outro software** (o Codex, com a conta ChatGPT do próprio cliente) e que **acessa a internet**.
   - **Funcionalidade restrita `runFullTrust`**: explique — “App de desktop que executa o Codex CLI já instalado pelo
     usuário, em modo somente leitura, numa pasta própria, para tarefas que o usuário pede no Kodexa AI Studio.”
   - **Privacidade**: informe a URL da política de privacidade do Kodexa (obrigatória para apps com internet) — o
     conector envia ao Kodexa só o texto das tarefas concluídas e o nome do computador.
   - **Listagem da loja (pt-BR)**: descrição, capturas de tela (a janela do conector e o painel “Seus computadores”),
     ícone (os PNGs de `packaging/msix/Assets` saem da marca `client/public/assets/brand/kodexa-app.svg`).
6. Envie para **certificação**. A Microsoft revisa (alguns dias) e pode pedir ajustes.
7. Aprovado, o link da loja (`ms-windows-store://pdp/?productid=...` / `apps.microsoft.com/...`) entra no painel do
   Kodexa no lugar do instalador `.cmd`.

Atualizações: aumente a versão (o workflow usa `1.0.<número da execução>.0`), gere de novo e envie um novo envio no
Partner Center. Os clientes recebem pela Store.

## Limites conhecidos

- A janela do conector é de console (texto). Um ícone ao lado do relógio exigiria uma interface nativa; fica para uma
  próxima versão.
- O conector precisa do Codex instalado e logado no computador; sem ele, avisa e não pareia.
- Mac e Linux continuam com `node kodexa-conector.mjs` (Configurar estúdio mostra os comandos).
