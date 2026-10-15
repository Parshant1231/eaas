'use strict';

const REFRESH_MS = 5000;
// Links are only rendered if they match exactly what the server is expected to produce
const SAFE_URL = /^http:\/\/(\d{1,3}\.){3}\d{1,3}:(30080|30300)$/;
const MAX_LOG_CHARS = 500000;

const ui = {
  form: document.getElementById('create-form'),
  name: document.getElementById('name'),
  size: document.getElementById('size'),
  ttl: document.getElementById('ttl'),
  createBtn: document.getElementById('create-btn'),
  message: document.getElementById('message'),
  banner: document.getElementById('banner'),
  body: document.getElementById('env-body'),
  empty: document.getElementById('empty'),
  capacity: document.getElementById('capacity'),
  panel: document.getElementById('build-panel'),
  title: document.getElementById('build-title'),
  stages: document.getElementById('stages'),
  log: document.getElementById('log'),
};

let environments = [];
let maxEnvironments = 3;
let pendingOpen = null; // { envId, job, until }
let activeBuild = null; // { job, number }
let stream = null; // EventSource
let stageTimer = null;

// Every dynamic value goes through textContent, never innerHTML
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function api(path, init) {
  const options = init || {};
  const headers = Object.assign({ 'X-EaaS-Request': '1' }, options.headers || {});
  if (options.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, Object.assign({}, options, { headers }));
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) throw new Error((data && data.error) || 'Request failed (HTTP ' + res.status + ')');
  return data;
}

function setMessage(text, isError) {
  ui.message.textContent = text;
  ui.message.className = isError ? 'error' : '';
}

function formatRemaining(expiresAt, state) {
  if (!expiresAt || state === 'failed') return '–';
  const ms = Date.parse(expiresAt) - Date.now();
  if (Number.isNaN(ms)) return '–';
  if (ms <= 0) return 'expired';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? hours + 'h ' + minutes + 'm' : minutes + 'm';
}

function linkCell(env) {
  const cell = document.createElement('td');
  const items = [['App', env.appUrl], ['Grafana', env.grafanaUrl]];
  let any = false;
  for (const [label, url] of items) {
    if (url && SAFE_URL.test(url)) {
      const a = el('a', label);
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      cell.appendChild(a);
      any = true;
    }
  }
  if (!any) cell.textContent = '–';
  return cell;
}

function actionCell(env) {
  const cell = document.createElement('td');

  const build = env.latestBuild;
  const logs = el('button', 'Logs', 'secondary');
  logs.type = 'button';
  logs.disabled = !build || build.number === null;
  logs.addEventListener('click', function () {
    openBuild(build.job, build.number, env.envId + ': ' + build.job + ' #' + build.number);
  });
  cell.appendChild(logs);

  const destroy = el('button', 'Destroy', 'danger');
  destroy.type = 'button';
  destroy.disabled = ['creating', 'destroying', 'failed'].includes(env.state);
  destroy.addEventListener('click', function () {
    destroyEnvironment(env.envId);
  });
  cell.appendChild(destroy);
  return cell;
}

function render() {
  ui.body.replaceChildren();
  ui.empty.hidden = environments.length > 0;

  for (const env of environments) {
    const row = document.createElement('tr');
    row.appendChild(el('td', env.envId, 'mono'));

    const stateCell = document.createElement('td');
    const badge = el('span', env.state, 'badge badge-' + env.state);
    badge.title = env.note || '';
    stateCell.appendChild(badge);
    row.appendChild(stateCell);

    row.appendChild(el('td', env.owner || '–'));
    row.appendChild(el('td', env.size || '–'));
    row.appendChild(el('td', env.ttlHours ? env.ttlHours + 'h' : '–'));

    const remaining = el('td', formatRemaining(env.expiresAt, env.state), 'remaining');
    remaining.dataset.expires = env.expiresAt || '';
    remaining.dataset.state = env.state;
    row.appendChild(remaining);

    row.appendChild(linkCell(env));
    row.appendChild(actionCell(env));
    ui.body.appendChild(row);
  }

  const used = environments.filter(function (e) { return e.state !== 'failed'; }).length;
  ui.capacity.textContent = 'Capacity: ' + used + ' / ' + maxEnvironments + ' environments';
}

function updateCountdowns() {
  document.querySelectorAll('td.remaining').forEach(function (cell) {
    cell.textContent = formatRemaining(cell.dataset.expires, cell.dataset.state);
  });
}

function closeStream() {
  if (stream) {
    stream.close();
    stream = null;
  }
}

function renderStages(data) {
  ui.stages.replaceChildren();
  for (const stage of data.stages) {
    const seconds = stage.durationMs ? ' (' + Math.round(stage.durationMs / 1000) + 's)' : '';
    ui.stages.appendChild(el('li', stage.name + seconds, 'stage stage-' + stage.status.toLowerCase()));
  }
}

function pollStages(job, number) {
  clearTimeout(stageTimer);
  const tick = async function () {
    if (!activeBuild || activeBuild.job !== job || activeBuild.number !== number) return;
    try {
      const data = await api('/api/builds/' + job + '/' + number + '/stages');
      renderStages(data);
      if (data.status !== 'IN_PROGRESS') return;
    } catch (e) {
      // the build may not have stages yet; retry
    }
    stageTimer = setTimeout(tick, 3000);
  };
  tick();
}

function appendLog(text) {
  const log = ui.log;
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.textContent += text;
  if (log.textContent.length > MAX_LOG_CHARS) log.textContent = log.textContent.slice(-Math.floor(MAX_LOG_CHARS * 0.8));
  if (nearBottom) log.scrollTop = log.scrollHeight;
}

function openBuild(job, number, title) {
  closeStream();
  activeBuild = { job: job, number: number };
  ui.panel.hidden = false;
  ui.title.textContent = title;
  ui.log.textContent = '';
  ui.stages.replaceChildren();

  const source = new EventSource('/api/builds/' + job + '/' + number + '/logs');
  stream = source;

  source.addEventListener('log', function (event) {
    appendLog(JSON.parse(event.data));
  });
  source.addEventListener('done', function (event) {
    const data = JSON.parse(event.data);
    appendLog('\n--- build finished: ' + (data.result || 'unknown') + ' ---\n');
    closeStream();
    pollStages(job, number);
    refresh();
  });
  source.addEventListener('failure', function (event) {
    appendLog('\n--- ' + JSON.parse(event.data).message + ' ---\n');
    closeStream();
  });
  // Closing on error stops EventSource from reconnecting and replaying the log from the start
  source.onerror = function () {
    closeStream();
  };

  pollStages(job, number);
}

function maybeAutoOpen() {
  if (!pendingOpen) return;
  if (Date.now() > pendingOpen.until) {
    pendingOpen = null;
    return;
  }
  const env = environments.find(function (e) { return e.envId === pendingOpen.envId; });
  const build = env && env.latestBuild;
  if (build && build.job === pendingOpen.job && build.number !== null) {
    openBuild(build.job, build.number, env.envId + ': ' + build.job + ' #' + build.number);
    pendingOpen = null;
  }
}

async function destroyEnvironment(envId) {
  if (!window.confirm('Destroy environment "' + envId + '"? This cannot be undone.')) return;
  try {
    await api('/api/environments/' + encodeURIComponent(envId), { method: 'DELETE' });
    setMessage('Destroy queued for "' + envId + '".', false);
    pendingOpen = { envId: envId, job: 'destroy', until: Date.now() + 120000 };
    await refresh();
  } catch (err) {
    setMessage(err.message, true);
  }
}

ui.form.addEventListener('submit', async function (event) {
  event.preventDefault();
  ui.createBtn.disabled = true;
  setMessage('Submitting…', false);
  try {
    const name = ui.name.value.trim();
    await api('/api/environments', {
      method: 'POST',
      body: JSON.stringify({ name: name, size: ui.size.value, ttlHours: Number(ui.ttl.value) }),
    });
    pendingOpen = { envId: name, job: 'create', until: Date.now() + 120000 };
    setMessage('Build queued for "' + name + '". Provisioning takes several minutes.', false);
    ui.name.value = '';
    await refresh();
  } catch (err) {
    setMessage(err.message, true);
  } finally {
    ui.createBtn.disabled = false;
  }
});

async function refresh() {
  try {
    const data = await api('/api/environments');
    environments = data.environments;
    maxEnvironments = data.maxEnvironments;
    ui.banner.hidden = true;
    maybeAutoOpen();
    render();
  } catch (err) {
    ui.banner.textContent = 'Cannot load environments: ' + err.message;
    ui.banner.hidden = false;
  }
}

function loop() {
  refresh().finally(function () {
    setTimeout(loop, REFRESH_MS);
  });
}

loop();
setInterval(updateCountdowns, 20000);
