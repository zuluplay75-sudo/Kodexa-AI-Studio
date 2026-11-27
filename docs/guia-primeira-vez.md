# Kodexa AI Studio — guia da primeira vez

O Kodexa é um escritório virtual em pixel art onde uma equipe de agentes de IA planeja os seus projetos. Os agentes
trabalham com a **IA do seu próprio computador** (o Codex, logado na sua conta do ChatGPT): sem chave de API e sem
cobrança extra além do seu plano ChatGPT. Você acompanha e comanda tudo pelo site, no computador ou no celular.

Leva uns 10 minutos na primeira vez.

## O que você precisa

- Um computador com **Windows 10 ou 11** (no Mac/Linux, veja o fim do guia).
- Uma conta do **ChatGPT** (Plus ou Pro) e uma conta **Google** (para entrar no Kodexa).
- Uns **800 MB livres** no disco: na primeira vez, o conector baixa (cerca de 200 MB) e instala o Codex oficial da OpenAI.

Não precisa instalar o Node.js nem usar comandos: o Kodexa Conector já traz o que precisa.

## 1. Entrar no Kodexa

1. Abra **https://kodexa.ia.br/login** e clique em **Entrar com Google**.
2. Você chega ao escritório em pixel art. Na primeira vez ele está **vazio**: é normal.

## 2. Conectar o seu computador (Kodexa Conector)

1. Baixe o **KodexaConector.zip**, clique com o botão direito › **Extrair tudo** e abra o **KodexaConector.exe**.
2. Se aparecer **"O Windows protegeu o computador"**, clique em **Mais informações** › **Executar assim mesmo**.
   (O aviso some quando o conector estiver na Microsoft Store.)
3. Na primeira vez, a janela pergunta se pode **instalar o Codex oficial da OpenAI**. Aperte **Enter** (sim). Ele baixa
   cerca de 200 MB, confere a assinatura do arquivo e instala numa pasta só do Kodexa.
4. Em seguida abre o navegador para você **entrar na sua conta do ChatGPT** (login do Codex). Entre e volte à janela.
5. A janela mostra um **código de 4 letras** e abre o navegador em **"Autorizar este computador?"**. Se o navegador não
   abrir, copie o endereço que aparece na janela.
6. Entre com Google, se pedir. Confira se o **código é o mesmo** da janela do conector e clique em
   **Autorizar este computador**.
7. A janela do conector mostra **"Computador conectado à sua conta do Kodexa"**.

**Deixe a janela do conector aberta** (pode minimizar). É por ela que os agentes trabalham. Se fechar, é só abrir o
`KodexaConector.exe` de novo: ele lembra do pareamento e não pede autorização outra vez.

Para conferir: no Kodexa, clique em **Configurar estúdio** (canto inferior direito) › **Conexões e limites das IAs**.
Em **Seus computadores** deve aparecer o seu computador como **ligado · Codex**.

## 3. Montar a sua equipe

1. Em **Configurar estúdio**, dê o **nome da sua empresa**.
2. Em **Equipe inicial**, clique em **Equipe padrão (8)** (Scout, Manager, Academy, Design, Network, Dev, QA e Shield)
   ou adicione agentes um a um. Pode trocar o nome e o cargo de cada um.
3. Clique em **Salvar configuração**. Os agentes aparecem no escritório e na lista à esquerda. O selo **X** ao lado de
   cada um quer dizer que ele usa o **Codex do seu computador**.

## 4. Criar o primeiro projeto

1. Clique em **Projetos IA** › **Novo projeto**.
2. Descreva o que você quer criar (um app, um jogo, um sistema) e clique em **Criar projeto**.
3. Em **IAs da equipe neste projeto** você vê qual IA cada agente vai usar.
4. Clique em **Executar Kodexa Scout**. A tarefa vai para o seu computador: na janela do conector aparece
   "Tarefa recebida (Codex)…" e depois "Tarefa concluída". O relatório aparece no projeto.
5. Leia as propostas do Scout, escreva a sua decisão e clique em **Aprovar e liberar Manager**.
6. Siga executando as etapas seguintes (Manager, Academy, Design, Network, Dev, QA, Shield). Cada uma usa o resultado
   das anteriores.

## 5. Acompanhar no escritório

Enquanto uma etapa roda, o agente dela aparece **trabalhando** no escritório (ponto verde, "Planejando no seu
computador") e o contador **trabalhando** sobe. Quando o Scout termina, ele **levanta a mão**: o projeto espera a sua
decisão (contador **precisa de você**). O painel **Atividade**, embaixo, lista o que cada agente concluiu.

## 6. Construir o projeto

Com as 8 etapas do planejamento concluídas, abra o projeto em **Projetos IA** e clique em
**Construir no meu computador**. O Codex cria o projeto numa pasta só dele, em `Kodexa\Projetos` dentro da sua pasta
de usuário, sem acesso à internet. Enquanto isso, o Kodexa Dev aparece trabalhando no escritório. No fim, o projeto
mostra o resumo, a lista de arquivos e, se for um app web, **Abrir prévia**. Para melhorar, clique em
**Construir de novo**: ele continua a partir do que já está na pasta.

## 7. Pelo celular

Abra **https://kodexa.ia.br/login** no celular e entre com a mesma conta Google. Você vê o mesmo escritório e os
mesmos projetos e pode executar etapas. Elas rodam no seu computador, então **ele precisa estar ligado** com o
conector aberto (e com internet).

## Se algo der errado

| O que aparece | O que fazer |
| --- | --- |
| Conector: "Codex: não encontrado" | Abra o conector de novo e aperte Enter quando ele perguntar se pode instalar o Codex. |
| Conector: "Sem conexão com o Kodexa" | Confira a internet. Se persistir, o site pode estar fora do ar: tente mais tarde. |
| Projeto: "o computador com o Kodexa Conector está desligado" | Abra o `KodexaConector.exe` e espere aparecer "Conectado". |
| Conector: "Tarefa não concluída: Not logged in" | Feche e abra o conector: ele abre o login do ChatGPT de novo. |
| Quero desconectar este computador | Configurar estúdio › Seus computadores › **Remover**. |
| Trocar a conta ou o computador | No Prompt de Comando, na pasta do conector: `KodexaConector.exe --esquecer`, e abra de novo. |

No planejamento, o conector roda o Codex em modo somente leitura. Na construção, o Codex escreve **só** na pasta do
projeto em `Kodexa\\Projetos`, sem internet. Nada fora dessas pastas é editado.

## Mac ou Linux

Com o Node.js e o Codex instalados e logados, em **Configurar estúdio** › **Gerar código de pareamento**, rode no
Terminal os dois comandos que aparecem (baixar o `kodexa-conector.mjs` e rodar com o código).
