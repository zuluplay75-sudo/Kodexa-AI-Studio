# Kodexa: domínio próprio via Cloudflare Tunnel (Codespaces)

Modo opcional para uso pessoal durante o desenvolvimento. Não é hospedagem permanente nem acesso público multiusuário. Sem a variável KODEXA_TUNNEL_HOST, o acesso privado anterior permanece inalterado.

## Pré-requisitos

- Domínio registrado e administrado pelo proprietário, adicionado ao Cloudflare.
- Cloudflare Zero Trust: criar primeiro uma aplicação Access self-hosted para o domínio escolhido, política Allow somente para o e-mail do proprietário (sem Bypass). Habilitar Protect with Access na rota do túnel e selecionar a aplicação correspondente.
- Instalar cloudflared no próprio Codespace conforme a documentação oficial. Não publicar portas no GitHub: a porta 4747 jamais pode ser encaminhada; o túnel deve chegar exclusivamente à 4748.
- Manter o login individual do Kodexa. O login e o Access são barreiras independentes; o Kodexa não confia em cabeçalhos de identidade encaminhados.

## Iniciar o servidor

Encerre a instância anterior. Na branch de desenvolvimento, depois de confirmar a CI:

    git pull --ff-only
    npm ci
    npm run typecheck
    npm test
    npm run build

Se já existe login, não o recrie. Caso contrário, use npm run login:setup localmente.

Substitua o domínio de exemplo pelo hostname realmente registrado e mantenha as variáveis das IAs já usadas na instalação:

    KODEXA_TUNNEL_HOST=kodexaia.com.br KODEXA_STUDIO_PROVIDER=codex-cli KODEXA_EXEC_CODEX_HOME="$HOME/.kodexa-codex" KODEXA_EXEC_ENABLED=1 npm run start:mobile

Em outro terminal, antes de conectar o túnel, valide:

    curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: kodexaia.com.br' http://127.0.0.1:4748/api/studio
    curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: kodexaia.com.br' http://127.0.0.1:4747/api/studio

Esperado: 401 e 403, respectivamente. Não prossiga se os resultados divergirem.

## Conectar o túnel

No painel Cloudflare crie um túnel gerenciado remotamente. Configure o hostname escolhido, serviço HTTP http://127.0.0.1:4748, preservando o Host público. Use Protect with Access e a aplicação restrita ao proprietário. Não crie outras rotas, nem use a porta 4747.

Instale cloudflared seguindo as instruções oficiais para seu ambiente. Execute em outro terminal do Codespace:

    read -rsp "Token do túnel: " TUNNEL_TOKEN
    echo
    export TUNNEL_TOKEN
    cloudflared tunnel run
    unset TUNNEL_TOKEN

Não envie o token por chat, não grave em arquivos do repositório, não o coloque na linha de comando e não use túnel público temporário. Revogue o token caso seja exposto.

Abra o hostname por HTTPS em janela privada: primeiro o Access deve pedir autenticação, depois o Kodexa deve pedir seu login. Verifique que usuário não autorizado não alcança o aplicativo, que logout funciona e que a API protegida não é acessível sem sessão. Teste sessões de IA e prévias individualmente. Não ative cache de páginas/API autenticadas. Para retornar ao acesso anterior, encerre o túnel e reinicie sem KODEXA_TUNNEL_HOST, com a porta 4748 Private no GitHub.

O Codespace e os processos precisam estar ativos; o endereço não evita suspensão, limites de uso ou eventual exclusão do ambiente. Não há garantia de disponibilidade 24 h.

Referências oficiais:
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/
