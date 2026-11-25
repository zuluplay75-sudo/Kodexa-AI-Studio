export const STAGES = [
  ['scout', 'Kodexa Scout', 'Pesquisa de campo: entenda o objetivo, proponha alternativas e compare concorrentes, público, riscos e diferenciais. Se houver pesquisa web, cite fontes verificadas; se não houver, não alegue ter pesquisado.'],
  ['manager', 'Kodexa Manager', 'Transforme a decisão aprovada em requisitos, arquitetura inicial, tarefas, dependências, critérios de aceite e prioridades.'],
  ['academy', 'Kodexa Academy', 'Identifique conhecimentos técnicos necessários, documentação de referência e lacunas; não afirme ter assistido vídeos ou acessado fontes que não recebeu.'],
  ['design', 'Kodexa Design', 'Defina experiência, direção de arte, interface, acessibilidade, assets e especificações de design.'],
  ['network', 'Kodexa Network', 'Projete infraestrutura, dados, APIs, autenticação, rede e implantação, com limites e custos.'],
  ['dev', 'Kodexa Dev', 'Prepare plano de implementação e instruções técnicas executáveis para uma sessão de programação real. Não afirme ter editado arquivos.'],
  ['qa', 'Kodexa QA', 'Prepare plano de testes, casos de erro e critérios de regressão. Não afirme que testes foram executados.'],
  ['shield', 'Kodexa Shield', 'Faça revisão de riscos do plano, ameaças, isolamento, permissões, segredos e verificações de segurança. Não afirme que o código foi auditado.'],
] as const;
export type StudioRole = typeof STAGES[number][0];
export type ProjectStage = { role: StudioRole; text: string; sources: string[]; at: string };
export type StudioProject = { id: string; brief: string; research: boolean; decision?: string; stages: ProjectStage[]; state: 'new'|'running'|'approval'|'ready'|'complete'|'failed'; error?: string; createdAt: string };
export type StudioInfo = { configured: boolean; webResearch: boolean; provider: string; projects: StudioProject[] };
