# Login individual do Kodexa no celular

Esta etapa usa a autenticação existente do servidor (scrypt, cookies assinados HttpOnly/SameSite, revogação e limite de tentativas). Não é cadastro público nem isolamento multiempresa.

No terminal do seu Codespace privado, na branch de desenvolvimento, pare a execução anterior com Ctrl+C. Remova o encaminhamento da porta 4747 na aba Ports. Não a encaminhe novamente: é a porta local usada pelos plugins.

    git pull --ff-only
    npm ci
    npm run typecheck
    npm test
    npm run build
    npm run login:setup
    npm run start:mobile

Escolha o usuário e a senha no terminal; somente o hash fica em ~/.kodexa-studio/owner-login.json (permissão 600). Não envie senha pelo chat nem pelo GitHub. Na aba Ports, encaminhe apenas 4748, visibilidade Private, protocolo HTTP interno. Abra a URL HTTPS gerada pelo GitHub. O proxy termina o TLS e o servidor de login escuta somente em loopback. Nunca torne a porta pública nem encaminhe 4747. O servidor não consegue conferir a visibilidade definida na interface do GitHub, portanto essa conferência é obrigatória.

O login protege a interface e a API remota; a porta local permanece para as integrações. O modo demo fica desligado na inicialização e não pode ser ligado pela API remota. O acesso remoto permite enviar mensagens, aprovar solicitações e iniciar sessões conforme a disponibilidade e as permissões das ferramentas instaladas, sem terminal interativo remoto. O Claude Code e o Codex ainda precisam estar instalados e autenticados no ambiente. Não cria automaticamente os oito agentes e não equivale a uma plataforma SaaS.

Para alterar a senha, pare o servidor, execute npm run login:setup novamente e reinicie. A mudança invalida sessões antigas. O arquivo fica no Codespace, que não é hospedagem permanente; se o ambiente for excluído, será preciso recriar a configuração. Não há recuperação por e-mail nesta etapa.

Não integrar à main até compilar, executar os testes e validar login, logout, acesso negado sem cookie e sessão real em Codespaces.

Para planejamento sem chave de API separada, consulte a opção codex-cli em kodexa-projects.md. O login do aplicativo e a autenticação da ferramenta de IA são independentes. Não envie chaves ou senhas pelo chat. Os testes de fumaça em CI validam o servidor compilado com credenciais de teste, não o proxy ou as contas reais do proprietário.
