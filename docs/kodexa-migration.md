# Kodexa AI Studio — migração de marca e execução real

Kodexa AI Studio é uma versão independente derivada do Habblaud (MIT). Os avisos de direitos autorais e a licença original permanecem. A marca visível e os metadados do pacote são Kodexa AI Studio; os identificadores técnicos legados continuam válidos para não interromper plugins, hooks, configurações de Docker, sessões e dados existentes.

## Executar sem a simulação

Requisitos: Node.js 22.12+ e acesso a um ambiente Linux/macOS (por exemplo, um Codespace). Na raiz do repositório:

    npm ci
    npm run typecheck
    npm test
    npm run build
    KODEXA_WORLD=0 npm run start:real

O modo real não cria agentes fictícios. O escritório observa sessões de Claude Code e Codex que realmente existam no ambiente de execução. Instalar e autenticar as ferramentas é necessário; o login e as permissões de cada provedor continuam sob controle do usuário. Nunca salve tokens ou chaves em arquivos versionados.

Para uma prévia no Codespaces, use uma porta privada e mantenha as proteções originais:

    KODEXA_HOST=0.0.0.0 KODEXA_ALLOWED_HOSTS="${CODESPACE_NAME}-4747.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}" KODEXA_WORLD=0 npm run start:real

Abra a porta 4747 na aba Ports, com visibilidade Private. Isso permite visualizar o escritório, mas não habilita terminal ou controle de sessões em uma porta exposta. O acesso remoto autenticado continua exigindo configuração própria conforme a documentação original. Não desative essa proteção nem torne a porta pública.

## Compatibilidade

Na inicialização do servidor, as variáveis KODEXA_* são traduzidas para os identificadores HABBLAUD_* correspondentes quando o identificador antigo não está definido. Em conflito, o valor legado prevalece, inclusive zero ou string vazia. KODEXA_ACADEMY_* é um namespace independente. Os scripts de instalação de plugins/Docker ainda podem exigir os nomes antigos; não os renomeie por substituição global.

A busca pela raiz aceita os dois nomes de pacote. A pasta ~/.habblaud, os IDs de plugins, nomes de cookies e contratos de API não são migrados nesta etapa. Assim não há cópia, exclusão ou perda automática de estado. Uma futura migração deve fazer backup, oferecer rollback e validar as integrações existentes antes de trocar identificadores técnicos.

O serviço World original não é um serviço independente Kodexa. Mantenha KODEXA_WORLD=0 em instalações independentes até haver uma implementação própria ou uma integração explicitamente autorizada. A atualização de versões agora usa o repositório Kodexa.

## Limites desta entrega

O modo real e a troca de marca não implementam, por si só, uma equipe autônoma de oito agentes. O Academy inicial e o assistente de configuração não substituem um orquestrador, integração real de credenciais, RAG, autenticação multiempresa, análise multimodal e hospedagem. Não exibir agentes simulados como sessões reais. As verificações da CI e um teste de ponta a ponta devem passar antes de incorporar à main ou publicar.
