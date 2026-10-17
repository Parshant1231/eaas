'use strict';

(function () {
  const E = window.EAAS;
  if (!E) return;

  const ui = {
    form: document.getElementById('inject-form'),
    env: document.getElementById('inject-env'),
    type: document.getElementById('inject-type'),
    btn: document.getElementById('inject-btn'),
    desc: document.getElementById('inject-desc'),
    message: document.getElementById('inject-message'),
    body: document.getElementById('inject-body'),
    empty: document.getElementById('inject-empty'),
  };

  let failures = [];
  let runs = [];

  function setMessage(text, isError) {
    ui.message.textContent = text;
    ui.message.className = isError ? 'error' : '';
  }

  function seconds(value) {
    return value === null || value === undefined ? '–' : value.toFixed(1) + 's';
  }

  function elapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return minutes + ':' + (rest < 10 ? '0' : '') + rest;
  }

  function busy() {
    return runs.some(function (r) { return r.queued || r.building; });
  }

  function updateButton() {
    const noEnv = ui.env.options.length === 0;
    ui.btn.disabled = noEnv || busy();
    ui.btn.title = noEnv
      ? 'Needs a ready medium environment'
      : (busy() ? 'An injection is already running' : '');
  }

  function describe() {
    const info = failures.find(function (f) { return f.type === ui.type.value; });
    ui.desc.textContent = info
      ? info.description + ' Expected recovery: ' + info.recovery + ' Expected run time: ' + info.expectedRun + '.'
      : '';
  }

  function fillTypes() {
    ui.type.replaceChildren();
    failures.forEach(function (f) {
      const option = document.createElement('option');
      option.value = f.type;
      option.textContent = f.label;
      ui.type.appendChild(option);
    });
    describe();
  }

  function fillEnvs() {
    const names = E.environments()
      .filter(function (e) { return e.state === 'ready' && e.size === 'medium'; })
      .map(function (e) { return e.envId; });
    const current = ui.env.value;
    const shown = Array.from(ui.env.options).map(function (o) { return o.value; });
    if (names.join(',') !== shown.join(',')) {
      ui.env.replaceChildren();
      names.forEach(function (name) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        ui.env.appendChild(option);
      });
      if (names.indexOf(current) !== -1) ui.env.value = current;
    }
    updateButton();
  }

  function cell(text, className) {
    return E.el('td', text, className);
  }

  function recoveryDetail(r) {
    const parts = [];
    if (r.revertSeconds !== null) parts.push('fault removed after ' + seconds(r.revertSeconds));
    if (r.alertSeconds !== null) parts.push(r.alertName + ' alert after ' + seconds(r.alertSeconds));
    if (r.restoredSeconds !== null) parts.push('node back after ' + seconds(r.restoredSeconds));
    if (r.target) parts.push('target: ' + r.target);
    return parts.join(' | ');
  }

  function renderRuns() {
    ui.body.replaceChildren();
    ui.empty.hidden = runs.length > 0;

    runs.forEach(function (run) {
      const row = document.createElement('tr');
      row.appendChild(cell(new Date(run.timestamp).toLocaleTimeString()));
      row.appendChild(cell(run.envId, 'mono'));
      row.appendChild(cell(run.failure));

      const status = document.createElement('td');
      const badge = document.createElement('span');
      let label;
      let cls;
      if (run.queued) { label = 'queued'; cls = 'badge-creating'; }
      else if (run.building) { label = 'running'; cls = 'badge-creating'; }
      else if (run.recovery && run.recovery.recovered) { label = 'recovered'; cls = 'badge-recovered'; }
      else if (run.recovery) { label = 'not recovered'; cls = 'badge-notrecovered'; }
      else { label = (run.result || 'unknown').toLowerCase(); cls = 'badge-failed'; }
      badge.className = 'badge ' + cls;
      badge.textContent = label;
      if (run.recovery) {
        badge.title = [run.recovery.mechanism, run.recovery.definition, run.recovery.notes]
          .filter(Boolean).join(' | ');
      }
      status.appendChild(badge);
      if (run.queued || run.building) {
        const timer = E.el('span', ' ' + elapsed(Date.now() - run.timestamp), 'timer mono');
        timer.dataset.start = String(run.timestamp);
        status.appendChild(timer);
      }
      row.appendChild(status);

      const r = run.recovery;
      row.appendChild(cell(r ? seconds(r.detectedSeconds) : '–'));
      const recovered = cell(r ? seconds(r.recoveredSeconds) : '–');
      if (r) recovered.title = recoveryDetail(r);
      row.appendChild(recovered);
      row.appendChild(cell(r ? r.failedRequests + ' / ' + r.totalRequests : '–'));

      const actions = document.createElement('td');
      const logs = E.el('button', 'Logs', 'secondary');
      logs.type = 'button';
      logs.disabled = run.number === null;
      logs.addEventListener('click', function () {
        E.openBuild('inject', run.number, run.envId + ': ' + run.failure + ' #' + run.number);
      });
      actions.appendChild(logs);
      row.appendChild(actions);

      ui.body.appendChild(row);
    });
    updateButton();
  }

  async function refreshRuns() {
    try {
      const data = await E.api('/api/injections');
      runs = data.injections;
      renderRuns();
    } catch (err) {
      // the main banner already reports connectivity problems
    }
  }

  ui.type.addEventListener('change', describe);

  ui.form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!ui.env.value) return;
    const name = ui.env.value;
    const label = ui.type.options[ui.type.selectedIndex].textContent;
    if (!window.confirm('Inject "' + label + '" into "' + name + '"? This deliberately breaks the environment.')) return;

    ui.btn.disabled = true;
    setMessage('Submitting…', false);
    try {
      await E.api('/api/environments/' + encodeURIComponent(name) + '/inject', {
        method: 'POST',
        body: JSON.stringify({ failure: ui.type.value }),
      });
      setMessage('Injection queued. The timer starts counting from when Jenkins queued it.', false);
      await refreshRuns();
    } catch (err) {
      setMessage(err.message, true);
    } finally {
      updateButton();
    }
  });

  async function init() {
    try {
      const data = await E.api('/api/failures');
      failures = data.failures;
      fillTypes();
    } catch (err) {
      setMessage('Could not load failure types: ' + err.message, true);
    }
    fillEnvs();
    refreshRuns();
  }

  setInterval(refreshRuns, 4000);
  setInterval(fillEnvs, 3000);
  setInterval(function () {
    document.querySelectorAll('.timer').forEach(function (node) {
      node.textContent = ' ' + elapsed(Date.now() - Number(node.dataset.start));
    });
  }, 1000);

  init();
})();
