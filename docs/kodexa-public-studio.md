# Kodexa público

O serviço público tem processo próprio e oferece cadastro com Google, projetos privados e planejamento com as chaves de IA de cada conta. Os projetos são persistidos no diretório público. As conexões e atribuições de IA ficam em memória, expiram com a última sessão da conta e precisam ser configuradas de novo após reiniciar o processo.

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

```sh
npm ci
npm run typecheck
npm run build:server
npm run start:public
```

A página fica em `/public/`. Confira `/public/health` e verifique que `/public/projects` retorna 401 sem sessão. Use dois perfis de navegador com contas Google diferentes. Na primeira conta, crie um projeto, conecte uma IA de teste e execute uma etapa com autorização de consumo. Na segunda, confirme que esse projeto e essa IA não aparecem. Volte à primeira conta, encerre a sessão e confirme que o acesso aos projetos exige novo login. Confira também que o painel privado do proprietário continua exigindo sua própria sessão.

O serviço público atual oferece planejamento. A execução de código, os terminais do proprietário, o runtime de prévia e os arquivos do Codespace permanecem fora das rotas públicas.
