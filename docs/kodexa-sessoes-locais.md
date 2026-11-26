# Conectar Codex e Claude Code no escritório Kodexa

O escritório detecta as sessões das ferramentas instaladas no mesmo ambiente. Use o seu computador Linux ou macOS, ou seu próprio ambiente remoto, com Node.js 22.12 ou superior. Faça login no Codex ou no Claude Code pelo terminal desse ambiente.

```sh
git clone https://github.com/zuluplay75-sudo/Kodexa-AI-Studio.git
cd Kodexa-AI-Studio
git switch --track origin/feat/kodexa-academy-bootstrap
npm ci
npm run build
npm run start:real
```

Abra `http://127.0.0.1:4747` no navegador do mesmo computador. Em um segundo terminal, abra `codex` ou `claude` na pasta do projeto e envie um prompt. O escritório usa os monitores já existentes para mostrar as sessões e as informações de uso que as ferramentas disponibilizam. Para opções adicionais de acompanhamento, consulte [a documentação do escritório](../README.pt-BR.md).

O cadastro Google e os projetos de planejamento web pertencem ao serviço público. As sessões de terminal deste escritório são acompanhadas pela sua própria instalação e aparecem nela.
