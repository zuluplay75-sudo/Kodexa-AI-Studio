import { STAGES } from '../../shared/studio-project';

export const publicStudioPage = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Projetos | Kodexa AI Studio</title>
<link rel="stylesheet" href="/public/studio.css"><script defer src="/public/studio.js"></script>
</head>
<body><main>
<p>Kodexa AI Studio</p><h1>Meus projetos</h1>
<a id="login" href="/public/google" hidden>Entrar com Google</a>
<section id="projects" hidden>
<button id="logout" type="button">Sair</button>
<details><summary>Minhas IAs</summary>
<form id="provider">
<label for="vendor">Provedor</label><select id="vendor"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></select>
<label for="model">Modelo</label><input id="model" required maxlength="101">
<label for="key">Chave de API</label><input id="key" type="password" autocomplete="off" required maxlength="512">
<button type="submit">Conectar IA</button>
</form>
<p id="connection"></p>
<form id="assignment" hidden>
<label for="role">Etapa</label><select id="role"><option value="default">Padrão da equipe</option>${STAGES.map(([id, name]) => '<option value="' + id + '">' + name + '</option>').join('')}</select>
<label for="assigned">IA conectada</label><select id="assigned"></select>
<button type="submit">Salvar atribuição</button>
<button id="disconnect" type="button">Desconectar IA selecionada</button>
<p id="assignments"></p>
</form></details>
<form id="create"><label for="brief">Descreva seu projeto</label>
<textarea id="brief" minlength="10" maxlength="4000" required></textarea>
<button type="submit">Criar projeto</button></form><ul id="list"></ul>
</section>
<p id="status" role="status"></p>
</main></body></html>`;

export const publicStudioStyles = `
:root { color-scheme: dark; background: #101626; color: #eef3ff; font: 16px/1.5 system-ui; }
main { max-width: 46rem; margin: 4rem auto; padding: 0 1.25rem; }
main > p:first-child { color: #8cd8ff; font-weight: 650; margin-bottom: 0; }
h1 { margin-top: .25rem; }
a, button { color: inherit; background: #253754; border: 1px solid #657da3; border-radius: .5rem; padding: .65rem 1rem; font: inherit; cursor: pointer; }
form { display: grid; gap: .75rem; margin: 2rem 0; }
input, select, textarea { font: inherit; background: #17223a; color: inherit; border: 1px solid #657da3; border-radius: .5rem; padding: .75rem; } textarea { min-height: 6rem; }
form button { justify-self: start; }
ul { padding: 0; list-style: none; }
li { background: #17223a; padding: .85rem; margin: .5rem 0; border-radius: .5rem; overflow-wrap: anywhere; }
`;

export const publicStudioScript = `
const login = document.getElementById('login');
const projects = document.getElementById('projects');
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
  status.textContent = '';
  try {
    await post('/public/provider', { provider: vendor.value, model: model.value.trim(), key: key.value.trim() });
    await refreshConnection();
  } catch (error) { showError(error); }
  finally { key.value = ''; }
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
  if (response.status === 401) return;
  if (!response.ok) throw new Error('Não foi possível abrir os projetos.');
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
    await refresh();
  } catch (error) { showError(error); }
});
const loginResult = new URLSearchParams(location.search).get('login');
const loginMessages = {
  expired: 'A tentativa de login expirou. Toque em Entrar com Google para começar novamente.',
  denied: 'O Google não autorizou o login. Tente novamente com uma conta cadastrada para teste.',
  provider: 'O Kodexa não conseguiu confirmar o login com o Google. Tente novamente.',
};
if (Object.hasOwn(loginMessages, loginResult)) status.textContent = loginMessages[loginResult];
refresh().then(refreshConnection).catch(showError);
`;
