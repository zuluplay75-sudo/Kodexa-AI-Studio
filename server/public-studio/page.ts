import { STAGES } from '../../shared/studio-project';

export const publicStudioPage = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Escritório | Kodexa AI Studio</title>
<link rel="stylesheet" href="/public/studio.css"><script defer src="/public/office.js"></script><script defer src="/public/studio.js"></script>
</head>
<body><main>
<header>Kodexa AI Studio</header>
<a id="login" href="/public/google" hidden>Entrar com Google</a>
<section id="projects" hidden>
<canvas id="office-map" aria-label="Escritório Kodexa"></canvas>
<nav aria-label="Escritório"><button data-panel="work">Projetos IA</button><button data-panel="settings">Configurar estúdio</button></nav>
<button id="logout" type="button">Sair</button>
<section class="panel" id="settings" hidden><button data-close>Voltar ao escritório</button><h1>Configurar estúdio</h1><details open><summary>Minha IA para projetos</summary>
<form id="provider">
<label for="vendor">Qual IA você quer usar?</label>
<select id="vendor"><option value="openai">OpenAI</option><option value="anthropic">Claude (Anthropic)</option><option value="gemini">Gemini (Google)</option></select>
<label for="key">Cole sua chave de API</label>
<input id="key" type="password" autocomplete="off" spellcheck="false" autocapitalize="none" required maxlength="512">
<a id="keyHelp" target="_blank" rel="noopener noreferrer" href="https://platform.openai.com/api-keys">Obter chave na OpenAI ↗</a>
<label for="model">Modelo para o planejamento</label>
<input id="model" required maxlength="101" spellcheck="false" autocapitalize="none">
<button type="submit">Usar esta IA</button>
<p id="providerFeedback" role="status"></p>
</form>
<p id="connection"></p>
<form id="assignment" hidden>
<label for="role">Etapa</label><select id="role"><option value="default">Padrão da equipe</option>${STAGES.map(([id, name]) => '<option value="' + id + '">' + name + '</option>').join('')}</select>
<label for="assigned">IA conectada</label><select id="assigned"></select>
<button type="submit">Salvar atribuição</button>
<button id="disconnect" type="button">Desconectar IA selecionada</button>
<p id="assignments"></p>
</form></details>
<details><summary>Conectar Codex e Claude Code</summary>
<p>Use o escritório do Kodexa no mesmo computador ou ambiente em que suas sessões do Codex e do Claude Code rodam. O escritório detecta essas sessões depois que você entra nas ferramentas pelo terminal.</p>
<p><a href="http://127.0.0.1:4747/">Abrir escritório neste computador</a></p><p>No celular, use o acesso remoto da sua instalação. O responsável pelo Codespace do Kodexa pode entrar com usuário e senha.</p><p><a href="https://kodexa.ia.br/login">Abrir escritório do responsável</a></p>
</details>
</section><section class="panel" id="work" hidden><button data-close>Voltar ao escritório</button><h1>Meus projetos</h1><form id="create"><label for="brief">Descreva seu projeto</label>
<textarea id="brief" minlength="10" maxlength="4000" required></textarea>
<button type="submit">Criar projeto</button></form><ul id="list"></ul></section>
</section>
<p id="status" role="status"></p>
</main></body></html>`;

export const publicStudioStyles = `
:root { color-scheme: dark; background: #101626; color: #eef3ff; font: 16px/1.5 system-ui; }
header { position: fixed; inset: 0 0 auto; height: 3rem; box-sizing:border-box; padding:.65rem 1rem; background:#202a38; font-weight:bold; }
#office-map { position:fixed; inset:3rem 0 0; width:100%; height:calc(100dvh - 3rem); touch-action:none; }
nav { position:fixed; right:.75rem; bottom:1rem; display:grid; gap:.5rem; }
#logout { position:fixed; right:.5rem; top:.2rem; padding:.35rem .8rem; }
.panel { position:fixed; inset:3rem 0 0 auto; box-sizing:border-box; width:min(100%,48rem); padding:1rem; overflow:auto; background:#101626; }
#status:not(:empty) { position:fixed; bottom:0; left:.5rem; max-width:80vw; background:#101626; }
main { max-width: 46rem; margin: 4rem auto; padding: 0 1.25rem; }
main > p:first-child { color: #8cd8ff; font-weight: 650; margin-bottom: 0; }
h1 { margin-top: .25rem; }
a, button { color: inherit; background: #253754; border: 1px solid #657da3; border-radius: .5rem; padding: .65rem 1rem; font: inherit; cursor: pointer; }
form { display: grid; gap: .75rem; margin: 2rem 0; }
input, select, textarea { font: inherit; background: #17223a; color: inherit; border: 1px solid #657da3; border-radius: .5rem; padding: .75rem; } textarea { min-height: 6rem; }
[hidden] { display: none !important; }
#provider { max-width: 32rem; }
#provider input, #provider select { min-width: 0; }
#keyHelp { justify-self: start; background: transparent; border: 0; padding: .25rem 0; color: #8cd8ff; }
#providerFeedback:empty { display: none; }
form button { justify-self: start; }
ul { padding: 0; list-style: none; }
li { background: #17223a; padding: .85rem; margin: .5rem 0; border-radius: .5rem; overflow-wrap: anywhere; }
`;

export const publicStudioScript = `
const login = document.getElementById('login');
const projects = document.getElementById('projects');
for (const button of document.querySelectorAll('[data-panel], [data-close]')) {
  button.onclick = () => {
    for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.id !== button.dataset.panel;
    if (button.dataset.panel) document.querySelector('#' + button.dataset.panel + ' [data-close]').focus();
    else document.querySelector('[data-panel="' + button.closest('.panel').id + '"]').focus();
  };
}
const list = document.getElementById('list');
const status = document.getElementById('status');
const brief = document.getElementById('brief');
const create = document.getElementById('create');
const submit = create.querySelector('button');
const provider = document.getElementById('provider');
const vendor = document.getElementById('vendor');
const model = document.getElementById('model');
const key = document.getElementById('key');
const connection = document.getElementById('connection');
const disconnect = document.getElementById('disconnect');
const assignment = document.getElementById('assignment');
const role = document.getElementById('role');
const assigned = document.getElementById('assigned');
const assignments = document.getElementById('assignments');
const roleNames = ${JSON.stringify(Object.fromEntries(STAGES.map(([id, name]) => [id, name])))};
const providerNames = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini' };
const providerSetup = {
  openai: ['gpt-4.1-mini', 'https://platform.openai.com/api-keys', 'OpenAI'],
  anthropic: ['claude-haiku-4-5', 'https://platform.claude.com/settings/keys', 'Claude Console'],
  gemini: ['gemini-2.5-flash', 'https://aistudio.google.com/apikey', 'Google AI Studio'],
};
const feedback = document.getElementById('providerFeedback');
function selectProvider() {
  const [suggestedModel, url, name] = providerSetup[vendor.value];
  const help = document.getElementById('keyHelp');
  help.href = url;
  help.textContent = 'Obter chave · ' + name + ' ↗';
  model.value = suggestedModel;
  key.value = '';
  feedback.textContent = '';
}
vendor.addEventListener('change', selectProvider);
selectProvider();
let polling;
let drafts = new Map();

async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error((await response.json()).error);
  return response;
}

async function refreshConnection() {
  const response = await fetch('/public/provider');
  if (!response.ok) return;
  const saved = await response.json();
  connection.textContent = saved.connections.length
    ? saved.connections.map(item => providerNames[item.provider] + ' · ' + item.model).join(' | ')
    : 'Conecte sua própria conta de IA.';
  assignment.hidden = !saved.connections.length;
  const selection = assigned.value;
  assigned.replaceChildren(...saved.connections.map(item => {
    const option = document.createElement('option');
    option.value = item.provider;
    option.textContent = providerNames[item.provider];
    return option;
  }));
  if (saved.connections.some(item => item.provider === selection)) assigned.value = selection;
  assignments.textContent = [
    'Padrão: ' + (providerNames[saved.defaultProvider] ?? 'sem IA'),
    ...Object.entries(saved.assignments).map(([id, value]) => roleNames[id] + ': ' + providerNames[value]),
  ].join(' · ');
}

provider.addEventListener('submit', async event => {
  event.preventDefault();
  const button = provider.querySelector('button[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  vendor.disabled = true;
  feedback.textContent = 'Configurando…';
  try {
    await post('/public/provider', { provider: vendor.value, model: model.value.trim(), key: key.value.trim() });
    key.value = '';
    feedback.textContent = 'Chave configurada para esta sessão. O provedor verifica o acesso ao executar uma etapa.';
    await refreshConnection();
  } catch (error) { feedback.textContent = error.message; }
  finally { button.disabled = false; vendor.disabled = false; }

});
assignment.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await post('/public/provider', { assign: true, provider: assigned.value, role: role.value });
    await refreshConnection();
  } catch (error) { showError(error); }
});
disconnect.addEventListener('click', async () => {
  try {
    await post('/public/provider', { disconnect: true, provider: assigned.value });
    await refreshConnection();
  } catch (error) { showError(error); }
});

function renderProject(project) {
  const row = document.createElement('li');
  const title = document.createElement('h2');
  title.textContent = project.brief;
  row.append(title);
  const team = document.createElement('details');
  const heading = document.createElement('summary');
  heading.textContent = 'Equipe deste projeto';
  team.append(heading);
  for (const [id, label] of Object.entries({default: 'IA padrão do projeto', ...roleNames})) {
    const field = document.createElement('label');
    field.style.display = 'grid';
    field.textContent = label;
    const choice = document.createElement('select');
    choice.add(new Option(id === 'default' ? 'Usar configurações da conta' : 'Herdar configuração', ''));
    for (const [value, name] of Object.entries(providerNames)) choice.add(new Option(name, value));
    let saved = project.team?.[id] || '';
    choice.value = saved;
    choice.disabled = project.state === 'running';
    choice.onchange = async () => {
      choice.disabled = true;
      try {
        await post('/public/projects/' + project.id + '/team', {role: id, provider: choice.value || null});
        saved = choice.value;
        note.textContent = 'Escolha salva neste projeto.';
      } catch (error) { choice.value = saved; note.textContent = error.message; }
      finally { choice.disabled = false; }
    };
    field.append(choice);
    team.append(field);
  }
  const note = document.createElement('p');
  note.setAttribute('role', 'status');
  team.append(note);
  row.append(team);
  for (const stage of project.stages) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const report = document.createElement('p');
    summary.textContent = roleNames[stage.role] + ' · ' + (providerNames[stage.provider] ?? stage.provider);
    report.textContent = stage.text;
    details.append(summary, report);
    row.append(details);
  }
  if (project.error) {
    const report = document.createElement('p');
    report.textContent = project.error;
    row.append(report);
  }
  if (project.state === 'running') {
    row.append('Planejamento em andamento…');
  } else if (project.state === 'complete') {
    row.append('Planejamento concluído.');
  } else {
    const approve = project.state === 'approval';
    const decision = document.createElement('textarea');
    decision.setAttribute('aria-label', 'Decisão sobre a pesquisa');
    decision.maxLength = 4000;
    decision.value = drafts.get(project.id) || '';
    decision.addEventListener('input', () => drafts.set(project.id, decision.value));
    const button = document.createElement('button');
    button.textContent = approve ? 'Aprovar pesquisa' : 'Executar próxima etapa';
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = '';
      try {
        await post('/public/projects/' + project.id + (approve ? '/approve' : '/next'), approve ? { decision: decision.value } : {});
        if (approve) drafts.delete(project.id);
        await refresh();
      } catch (error) { showError(error); }
      finally { button.disabled = false; }
    });
    if (approve) row.append(decision);
    row.append(button);
  }
  return row;
}

async function refresh() {
  clearTimeout(polling);
  const response = await fetch('/public/projects');
  login.hidden = response.status !== 401;
  projects.hidden = !response.ok;
  if (response.status === 401) {
    if (Object.hasOwn(loginMessages, loginResult) && new URLSearchParams(location.search).has('login')) {
      status.textContent = loginMessages[loginResult];
    }
    return;
  }
  if (!response.ok) throw new Error('Não foi possível abrir os projetos.');
  if (Object.hasOwn(loginMessages, loginResult)) {
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete('login');
    history.replaceState(null, '', cleanUrl);
    if (status.textContent === loginMessages[loginResult]) status.textContent = '';
  }
  window.dispatchEvent(new Event("kodexa-office-ready"));
  const rows = await response.json();
  if (rows.length) list.replaceChildren(...rows.map(renderProject));
  else list.textContent = 'Nenhum projeto criado.';
  if (rows.some(project => project.state === 'running')) polling = setTimeout(() => refresh().catch(showError), 2500);
}

function showError(error) { status.textContent = error.message; }
create.addEventListener('submit', async event => {
  event.preventDefault();
  submit.disabled = true;
  status.textContent = '';
  try {
    const response = await fetch('/public/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: brief.value, research: false })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    create.reset();
    await refresh();
  } catch (error) { showError(error); }
  finally { submit.disabled = false; }
});
document.getElementById('logout').addEventListener('click', async () => {
  try {
    const response = await fetch('/public/logout', { method: 'POST' });
    if (!response.ok && response.status !== 401) throw new Error('Não foi possível sair.');
    list.replaceChildren();
    drafts.clear();
    provider.reset();
    connection.textContent = '';
    assignment.hidden = true;
    assignments.textContent = '';
    create.reset();
    window.location.replace('https://kodexa.ia.br/login');
  } catch (error) { showError(error); }
});
const loginResult = new URLSearchParams(location.search).get('login');
const loginMessages = {
  expired: 'A tentativa de login expirou. Toque em Entrar com Google para começar novamente.',
  denied: 'O Google não autorizou o login. Tente novamente com uma conta cadastrada para teste.',
  provider: 'O Kodexa não conseguiu confirmar o login com o Google. Tente novamente.',
};

refresh().then(refreshConnection).catch(showError);
`;

