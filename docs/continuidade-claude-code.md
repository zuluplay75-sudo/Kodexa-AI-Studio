# Continuidade do Kodexa AI Studio no Claude Code

## Missão e forma de trabalhar

Atue como desenvolvedor responsável por continuar o Kodexa em português do Brasil. O produto é um escritório virtual em pixel art onde cada cliente configura uma equipe e atribui suas próprias IAs aos agentes de cada projeto. A interface de referência é o escritório original deste repositório. Reutilize seus componentes e sua navegação no computador e no celular. Trabalhe em etapas pequenas, implemente, teste e siga para a próxima etapa autorizada. Uma pendência externa de um provedor deixa as demais frentes livres. Entregue evidências e diferencie código pronto, teste local, publicação e validação no site.

Este documento registra a passagem de trabalho em 27/11/2026. Confirme o estado atual antes de modificar arquivos. Preserve projetos, arquivos locais do usuário, configurações, históricos e o túnel Cloudflare existente. Use dados descartáveis para testes. Não inclua credenciais, cookies, códigos de autorização, tokens do túnel, chaves ou conteúdo de projetos reais em commits, logs, prints ou relatos.

## Onde começar

- Repositório `zuluplay75-sudo/Kodexa-AI-Studio`. O escritório público foi desenvolvido em `feat/kodexa-public-studio`. A área de trabalho principal do Codespace também foi vista em `feat/kodexa-academy-bootstrap`. Compare os históricos antes de integrar alterações entre elas.
- No terminal, comece com `pwd`, `git status --short --branch`, `git worktree list` e `git log -1 --oneline --decorate`. Leia `AGENTS.md`, `CLAUDE.md` e as instruções aplicáveis aos diretórios alterados. Atualize as referências remotas. Se a área atual contiver trabalho do usuário ou estiver em outra branch, use um worktree separado a partir da branch pública. Evite sobrescrever alterações locais, inclusive em `.vscode/`.
- Compare `client/src/main.ts` e `client/src/app.ts` do escritório original com `client/src/public-office.ts`, a entrada do escritório do cliente. O original é referência visual e de interação. O processo público deve continuar restrito ao cliente autenticado.
- Leia `docs/kodexa-public-studio.md` e `docs/kodexa-sessoes-locais.md`. Confronte esses documentos com o código e o processo que está efetivamente em execução. Há registros antigos de operações manuais na pasta de release do Codespace.

| Área | Arquivos e pontos de entrada |
|---|---|
| Mapa e escritório | `client/src/world/`, `client/src/ui/index.ts`, `sidebar.ts`, `topbar.ts`, `usage.ts` no mesmo diretório, `client/src/net/store.ts` |
| Configurar estúdio | `client/src/studio/onboarding.ts`, `prefs.ts`, `onboarding.css` |
| Projetos IA e prévia | `client/src/studio/projects.ts`, `preview.ts`, `projects.css`, `shared/studio-project.ts`, `server/studio/projects.ts` |
| Contas e planejamento público | `server/public-studio/app.ts`, `google.ts`, `planning.ts`, `start.ts` e `app.test.ts` |
| Dados de ferramentas locais | `server/sources/`, incluindo Codex, e os scripts de uso, instalação e diagnóstico do `package.json` |
| Academy e vídeos | `server/academy/`, inclusive `video-vision.ts` e seu teste; examine os requisitos da versão presente |
| Publicação | `scripts/build-server.mjs`, scripts de build e inicialização no `package.json`, processo do Codespace e suas rotas existentes |

## Estado observado

1. A entrada usada de verdade é `https://kodexa.ia.br/login`. O botão Google inicia a autenticação no domínio público e retorna a `https://studio.kodexa.ia.br/public/`. O callback é `https://studio.kodexa.ia.br/public/google/callback`. Os domínios observados usam **ia.br**. O teste com uma sessão Google já autenticada chegou ao escritório. Ainda falta testar o primeiro acesso com uma conta inédita e em um celular físico.
2. A tela inicial é o mapa. Os botões originais **Configurar estúdio** e **Projetos IA** ficam no canto inferior direito. A antiga página paralela de “Meus projetos” foi removida. Preserve a navegação original. **Sair** deve voltar à página de login.
3. A lateral e o topo originais foram publicados e conferidos após recarregar o domínio. Na conta usada no teste havia oito agentes. A busca, a sala, os controles de câmera e os dois botões estavam presentes. Parte da interface apareceu em inglês e havia indicadores de conta desconhecida. A conta usada não comprova o comportamento de estreia de um cliente.
4. O serviço público já isola projetos por usuário. Configurações de escritório e atribuições por projeto têm armazenamento próprio. A implementação pública mantém conexões de provedores em memória. Reinícios podem exigir novo login e nova conexão. Há testes anteriores de separação entre contas e entre projetos. Execute-os novamente na revisão a publicar.
5. A integração disponível no painel chama OpenAI, Anthropic ou Gemini por chave. Uma chave aceita pelo formulário só é verificada pelo provedor ao executar uma chamada. Já houve limite de uso HTTP 429 da OpenAI. Nenhuma dessas observações comprova que uma assinatura pessoal está vinculada.
6. A OpenAI confirmou o recebimento do formulário do Kodexa para **login e uso do plano ChatGPT para solicitações de IA**. A aprovação e as credenciais dessa modalidade estão pendentes. O login Google do Kodexa é independente desse pedido. Evite enviar outra candidatura sem motivo.
7. A instalação conhecida usa Codespaces e o túnel `kodexa-studio`. O serviço público escuta em loopback na porta 4750. O escritório local do responsável usa 4747 na configuração documentada. Já ocorreram erros Cloudflare 1033 e 502. Render foi discutido como alternativa. Nenhuma migração para Render foi confirmada.

## Ordem de execução e critérios de aceite

### 1. Escritório original, idioma e dados reais

Verifique o primeiro carregamento, a recarga e o retorno depois do login. Compare o escritório publicado com o cliente original. Ajuste o idioma inicial em pt-BR conforme as preferências do produto e preserve a escolha explícita de idioma. Confira o logotipo Kodexa e a placa KX no mapa. Identifique controles herdados que dependam de rotas locais do proprietário e habilite no público apenas os que funcionam com autorização e dados do cliente.

Conta nova deve começar com mapa e navegação, zero agentes e zero cartões de conexões. Conta existente deve recuperar sua empresa, equipe e preferências. Nome e cargo editados devem aparecer no configurador, na lateral e sobre o personagem. Verifique nomes personalizados, inclusive PCIC, ACC, GTC e PC, sem fixá-los para todos.

Revise a origem dos contadores. Na implementação de passagem, o cliente público monta o snapshot a partir das preferências e atribui estado ocioso aos membros. Conecte o estado de execução e as atividades aos eventos reais e autorizados de cada projeto. Confira o que a busca realmente indexa. Elimine identificadores “?” quando houver associação conhecida e use uma indicação clara quando nenhum provedor tiver sido vinculado. Para limites de Codex, Claude e Gemini, use apenas métricas realmente disponíveis para aquela conexão. Identifique a janela, a última atualização e a indisponibilidade. Nunca extrapole os números da conta do responsável para os clientes.

**Aceite:** em duas contas distintas, cada pessoa vê apenas seus projetos, agentes, conexões e atividade. A primeira sessão vazia não herda equipe de demonstração. Recarregar mantém os dados próprios. Os menus continuam acessíveis numa tela estreita e os textos cabem no celular.

### 2. Identidade, acesso e sessões

Mantenha cadastro público por Google para clientes e acesso do responsável conforme a configuração existente. Confira a situação de publicação do consentimento no Google antes de declarar cadastro aberto a qualquer pessoa. Valide origem e callback exatos, expiração, cancelamento, duas abas, logout, sessão vencida e reinício. Já houve retorno “Autorização inválida ou expirada” e uma tela que exibia “Sair” ao pedir novo login. Trate esses estados no painel original. Preserve isolamento entre a sessão do Kodexa e as autorizações das IAs. Se implementar reconexão persistente, defina expiração, revogação e proteção das credenciais no servidor. A preferência é evitar que o cliente repita login a cada visita.

**Aceite:** login leva ao escritório e logout volta a `/login`. Uma sessão expirada não revela projetos nem configurações. Uma segunda conta no mesmo navegador não herda o estado privado da primeira.

### 3. Conexões pessoais e atribuições por agente

O objetivo é **ChatGPT como primeira escolha** e cada cliente utilizando sua própria conta elegível. Dentro de **Configurar estúdio**, distinguir ChatGPT, Claude, Claude Code e Gemini pelos fluxos realmente suportados. O usuário deseja usar pelo celular mesmo com o computador pessoal desligado. Isso depende de um executor hospedado ligado e de autorização válida para esse modo.

- **ChatGPT:** aguardar habilitação específica para o site hospedado. Consultar a documentação oficial atual. Quando autorizado, implementar o fluxo registrado, validar identidade e consentimento para inferência, vincular ao usuário Kodexa autenticado e permitir desconectar. Solicitar apenas os dados necessários. Projetos e conversas pessoais do ChatGPT estão fora do escopo. Não confundir login de identidade com autorização de uso do plano, nem API com assinatura. O callback local de clientes instalados não substitui o callback web de um serviço multiusuário.
- **Claude e Claude Code:** conferir as modalidades permitidas pela Anthropic. Oferecer API como opção identificada e Claude Code pelo fluxo oficial aplicável. Não coletar login ou token de sessão do Claude.ai para retransmitir chamadas de clientes. Não compartilhar uma sessão de terminal entre usuários.
- **Gemini:** preservar a integração atual e validar por último, conforme pedido. Informar quando o modelo escolhido admitir nível gratuito, quais limites se aplicam e o pré-requisito de projeto/credencial. Um login Google no Kodexa, por si só, não autoriza inferência Gemini.
- **Atribuições:** manter padrão da conta, padrão por projeto e exceções por agente. Conferir a precedência real em `connectionFor`, inclusive a interação com atribuições de agente na conta. Tornar visível qual IA será usada em cada etapa. Salvar alteração no projeto A não pode alterar o B. Ao desconectar ou atingir um limite, preservar resultados, indicar a etapa afetada e permitir retomada. Evitar troca silenciosa para provedor pago.

**Aceite:** testar provedor conectado e desconectado, troca de agente em um único projeto, persistência das atribuições, rejeição de chave, cota esgotada e retomada. Relatar separadamente teste simulado e chamada real. Chamadas pagas exigem autorização de custo.

### 4. Projetos IA, Oficina HP e execução

Preserve o diálogo original com lista, **Novo projeto**, descrição, detalhe e volta. Organize as informações de forma progressiva, com ações da etapa visíveis e relatórios detalhados recolhidos. Inspecione criação, escolha de equipe, planejamento, aprovação, execução, retomada, versões e prévia. Diferencie as capacidades habilitadas no escritório local e no público. No público, uma ação dependente de executor precisa de isolamento por cliente antes de ser habilitada.

Reproduza em cópia de teste o caso relatado como **Oficina HP**. A captura da prévia dizia “Oficina em Dia”; confirme ID e arquivos antes de tratar como o mesmo projeto. Já foram relatados “Iniciar aplicativo” sem resposta, prévia parada em “Carregando” e erro ao abrir a versão completa. Descubra entrypoint, backend, porta e URL reais do projeto. Verifique se a requisição chega ao servidor, se o processo inicia e se responde antes de oferecer o link. Na prévia estática, explique dependências de JavaScript e backend; na versão completa, entregue resposta visível de inicialização ou erro acionável. Preserve portas privadas e o isolamento entre clientes.

**Aceite:** criar um projeto descartável, chegar à tela de descrição, executar o fluxo autorizado e abrir a versão correta em desktop e celular. Validar separadamente HTML estático e aplicativo com backend. Entregar captura da tela após a descrição e da prévia funcional. Nenhum teste deve sobrescrever um projeto existente.

### 5. Academy, ferramentas e testes

Revisar integração do Academy com vídeo e consentimento para processamento audiovisual. Confirmar o projeto e a procedência do componente solicitado como “Claude Video Vision”, sua interface de execução e se a versão em uso depende de binário externo. Examinar Node, Codex, Claude, ffmpeg e ffprobe no ambiente que realmente executa o serviço. A foto antiga mostrava Node 24.22.2, Codex e Claude no PATH, sem ffmpeg, ffprobe nem claude-video-vision no PATH. Isso é histórico. Confirme novamente. Instale apenas dependências necessárias e verificadas. Teste primeiro Codex, depois Claude, depois Gemini; registre se cada um foi apenas detectado, autenticado ou executou uma tarefa.

Na cópia de desenvolvimento, use o lockfile e a versão de Node suportada. Execute os comandos abaixo individualmente para preservar o resultado e a causa de eventuais falhas.

```bash
npm ci
npm run typecheck
npm run i18n:check
npm run build
npm test
```

Já houve falhas intermitentes em `server/sources/watcher.test.ts` e `server/sources/tail.test.ts`. Em uma execução antiga, o teste de truncamento/reescrita recebeu `reset=false` quando esperava `true`. Repita os arquivos afetados isoladamente e em conjunto, investigue a causa e rode a suíte completa após corrigir. Registre versão, totais, falhas e testes pulados. Os 14 testes mencionados no histórico eram um recorte. Use diretório temporário para logs e artefatos intermediários.

### 6. Revisão defensiva, publicação e serviço contínuo

Depois dos testes funcionais, execute **uma revisão por vez**: (1) revisão de superfície e limites de acesso, (2) revisão de autenticação, credenciais e isolamento, (3) busca de bugs de permissão e regressões com código e fixtures, (4) AppSec/SecOps de dependências, logs, deploy e recuperação. Use análise de código e testes defensivos com contas descartáveis. Registre achado, impacto, correção e teste de regressão. Não realizar ataques ou exploração em produção.

Use build verificado e revisão identificável para publicar. Confirme como o processo ativo encontra a pasta de release, como reinicia após suspensão e como reverter. Prefira publicação reproduzível a copiar arquivos avulsos. Valide o health check, HTML, JS e CSS pelo domínio público e, em seguida, a interface após login. `HTTP 200` de um arquivo sozinho não valida a jornada. Para 1033, verifique o conector e o túnel existentes; para 502, verifique origem, processo, porta e protocolo antes de mexer no DNS. Persistência de projetos e disponibilidade contínua são requisitos distintos. Levante opções de hospedagem com volume persistente, backup restaurável e custo em reais antes de contratar ou migrar. Não contratar serviço pago nem substituir o túnel sem decisão do responsável.

## Relatório que encerra cada rodada

Informe a branch e o commit, o que mudou para o cliente, testes executados e seus resultados, qual versão está no domínio e o que foi visto após login. Inclua os passos para verificar e reverter a publicação. Separe pendências do produto de dependências externas, como aprovação da OpenAI, autorização de uma conta pessoal e validação em aparelho físico. Se uma delas bloquear uma frente, continue as demais. Comece pela seção 1 e pelo primeiro teste de conta nova da seção 2.
