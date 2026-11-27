// Ponto de entrada do Kodexa Conector como executável único (Node SEA): o pacote CommonJS do .exe não tem
// import.meta, então o "rodar se for o principal" do kodexa-connector.ts não serve aqui.
import { main } from './kodexa-connector';

main(process.argv.slice(2)).catch((error: Error) => {
  console.error('[kodexa] ' + error.message);
  // No duplo clique, a janela fecharia na hora: espera o Enter para a pessoa conseguir ler o motivo.
  if (process.stdin.isTTY) {
    console.error('[kodexa] Pressione Enter para fechar.');
    process.stdin.once('data', () => process.exit(1));
  } else process.exit(1);
});
