# Kodexa Academy — primeira implementação

Este módulo inicializa um currículo padrão para os oito cargos do Kodexa no primeiro início do servidor fora do modo demo. O estado fica no diretório de dados configurado, em academy/state.json, e não deve entrar no Git. Esta etapa é para uma instalação individual, não para múltiplas empresas.

## Ativar aprendizado e descoberta

O currículo é criado sem credenciais e sem chamadas externas. Para autorizar o processamento automático, configure as variáveis abaixo no ambiente local ou nos segredos privados do Codespaces, nunca em arquivos versionados:

- KODEXA_ACADEMY_AUTO=1
- KODEXA_ACADEMY_PROVIDER=openai ou anthropic
- KODEXA_ACADEMY_MODEL: identificador de modelo disponível na API escolhida e compatível com o endpoint.
- OPENAI_API_KEY ou ANTHROPIC_API_KEY: chave privada da API correspondente.
- YOUTUBE_API_KEY: chave opcional da YouTube Data API v3 para descobrir links de vídeos.
- KODEXA_ACADEMY_DAILY_MODEL_CALLS: padrão 4, máximo 16.
- KODEXA_ACADEMY_DAILY_VIDEO_SEARCHES: padrão 2, máximo 8.

As chaves de API podem ter cobrança própria, diferente de assinaturas do ChatGPT/Claude Code. Os limites acima são de tentativas, não um teto monetário. Cada processamento limita o trecho enviado e o número de tokens de saída. O conteúdo de fontes é enviado ao provedor escolhido; não envie dados privados sem autorização. Ajuste também os limites de gastos no provedor.

Depois de configurar o ambiente, execute npm install, npm run build e npm start. O worker é iniciado automaticamente e verifica a fila a cada hora; o orçamento é reiniciado por dia UTC, persiste em disco e não é reiniciado a cada abertura do servidor. A atualização de fontes bem-sucedidas é tentada após 30 dias. Falhas são registradas sem fabricar resultados. Os endereços iniciais são fixos; redirecionamentos não são aceitos.

## Comandos locais (ambiente de desenvolvimento)

    npm run academy -- status
    npm run academy -- run
    npm run academy -- notes dev
    npm run academy -- transcript design "referência do vídeo autorizado" ./transcricao.txt

O comando transcript analisa segmentos de texto que o operador tem direito de usar, de 100 a 16000 caracteres. Não baixa vídeos de terceiros nem analisa imagens, áudio ou legendas automaticamente. A descoberta de vídeos guarda título, canal, link e data, marcados como discovered. Uma nota gerada também não é uma validação técnica. Para vídeos extensos, use segmentos autorizados com referências distintas. A leitura de notas é local; não há publicação automática.

Não há chamadas externas se KODEXA_ACADEMY_AUTO não for 1. O modo demo não inicia a fila. Os comandos e servidor usam o mesmo diretório de dados. A trava de processamento impede dois escritores simultâneos. Se o processo for encerrado à força e deixar academy/.worker-lock, confirme que nenhum worker está ativo antes de remover somente esse diretório vazio.

## Verificação

    npm run typecheck
    npm test -- server/academy/bootstrap.test.ts
    npm run build

Os testes usam respostas falsas, sem credenciais reais. Verifique também a disponibilidade das fontes e do modelo configurado em um ambiente autorizado.

## Próximas etapas

- Assistente visual de primeiro login e seleção de equipe; cadastro e permissões individuais.
- Integração da biblioteca com sessões reais Claude Code/Codex, busca semântica RAG e validação técnica das notas.
- Ingestão multimodal de vídeo/áudio e pesquisa adicional com provedores autorizados.
- Painel de estudos, orçamento monetário, isolamento por empresa e controle de acesso.
- Orquestração Scout/Manager e distribuição automática de conhecimento.
- Revisão de segurança e testes reais de integração antes de produção.

A implementação não retreina modelos, não certifica agentes e não altera a licença MIT original.
