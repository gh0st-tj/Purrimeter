(function () {
  const $ = sel => document.querySelector(sel);
  const app = () => $('#app');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function apiBase() {
    if (window.PURRIMETER_API_BASE) return window.PURRIMETER_API_BASE.replace(/\/$/, '');
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3000';
    return `${location.protocol}//api.${h.replace(/^www\./, '')}`;
  }
  const API_BASE = apiBase();
  const S = { loggedIn: false, stats: null, levels: [], message: '' };

  async function api(path, opts = {}) {
    const res = await fetch(API_BASE + path, {
      ...opts,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `API ${res.status}`);
    return data;
  }

  function toast(message) {
    S.message = message;
    render();
  }

  async function loadAdmin() {
    try {
      const [stats, levels] = await Promise.all([
        api('/api/admin/stats'),
        api('/api/admin/levels'),
      ]);
      S.loggedIn = true;
      S.stats = stats;
      S.levels = levels.levels || [];
    } catch {
      S.loggedIn = false;
    }
    render();
  }

  function renderLogin() {
    return `
      <section class="hero-card">
        <div>
          <div class="eyebrow">Owner only</div>
          <h1>Purrimeter Admin</h1>
          <p>Generate, verify, and publish daily gardens.</p>
        </div>
        <div class="hero-art" aria-hidden="true">
          <span class="hero-cat cat">🐈</span>
          <span class="hero-fence">▥▥▥</span>
        </div>
      </section>
      <div class="card">
        <label>Admin password</label>
        <input id="password" type="password" autocomplete="current-password">
        <div class="actions" style="justify-content:flex-start">
          <button class="btn primary" id="login">Log in</button>
          <a class="btn" href="index.html">Back to game</a>
        </div>
        ${S.message ? `<div class="small soft">${esc(S.message)}</div>` : ''}
      </div>`;
  }

  function renderAdmin() {
    const stats = S.stats || {};
    const levelRows = S.levels.length ? S.levels.map(level => `
      <div class="lb-row">
        <div class="grow">
          <b>${esc(level.name)}</b>
          <div class="small soft">${esc(level.status)} · target ${level.target}</div>
        </div>
        <input class="publish-day" data-id="${esc(level.id)}" inputmode="numeric" placeholder="day #">
        <button class="btn primary" data-publish="${esc(level.id)}">Publish</button>
      </div>`).join('') : '<div class="center soft" style="padding:20px">No generated drafts yet.</div>';
    return `
      <div class="row" style="margin:10px 0">
        <h1 class="grow">Admin</h1>
        <a class="btn" href="index.html">Game</a>
        <button class="btn ghost" id="logout">Log out</button>
      </div>
      <div class="stats">
        <div class="stat"><b>${stats.players ?? '—'}</b><span>players</span></div>
        <div class="stat"><b>${stats.submissions ?? '—'}</b><span>submissions</span></div>
        <div class="stat"><b>${stats.aiDrafts ?? '—'}</b><span>drafts</span></div>
        <div class="stat"><b>${stats.published ?? '—'}</b><span>dailies</span></div>
      </div>
      <div class="card">
        <h3>Generate level</h3>
        <label>Provider</label>
        <select id="provider">
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
        </select>
        <label>Design hint</label>
        <input id="hint" maxlength="160" placeholder="river garden with one tempting tuna">
        <div class="actions" style="justify-content:flex-start">
          <button class="btn primary" id="generate">Generate draft</button>
        </div>
      </div>
      <div class="card">
        <h3>Regenerate a daily</h3>
        <div class="small soft">This replaces that day and deletes existing daily submissions for that day.</div>
        <div class="row" style="margin-top:8px">
          <input id="regen-day" inputmode="numeric" placeholder="day #">
          <button class="btn" id="regenerate">Regenerate</button>
        </div>
      </div>
      <div class="card">
        <h3>Drafts</h3>
        ${levelRows}
      </div>
      ${S.message ? `<div class="card small soft">${esc(S.message)}</div>` : ''}`;
  }

  function render() {
    app().innerHTML = S.loggedIn ? renderAdmin() : renderLogin();
    bind();
  }

  function bind() {
    const login = $('#login');
    if (login) login.onclick = async () => {
      login.disabled = true;
      try {
        await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
        S.message = '';
        await loadAdmin();
      } catch (e) {
        login.disabled = false;
        toast(e.message);
      }
    };
    const logout = $('#logout');
    if (logout) logout.onclick = async () => {
      await api('/api/admin/logout', { method: 'POST', body: '{}' }).catch(() => {});
      S.loggedIn = false;
      render();
    };
    const generate = $('#generate');
    if (generate) generate.onclick = async () => {
      generate.disabled = true;
      generate.textContent = 'Generating...';
      try {
        const out = await api('/api/admin/generate', {
          method: 'POST',
          body: JSON.stringify({ provider: $('#provider').value, hint: $('#hint').value }),
        });
        toast(`Generated ${out.def.name} with target ${out.target}.`);
        await loadAdmin();
      } catch (e) {
        toast(e.message);
      }
    };
    const regenerate = $('#regenerate');
    if (regenerate) regenerate.onclick = async () => {
      const day = Number($('#regen-day').value);
      if (!day) return toast('Enter a day number.');
      try {
        await api('/api/admin/daily/regenerate/' + day, { method: 'POST', body: '{}' });
        toast('Daily regenerated.');
        await loadAdmin();
      } catch (e) {
        toast(e.message);
      }
    };
    document.querySelectorAll('[data-publish]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.publish;
        const day = Number(document.querySelector(`.publish-day[data-id="${CSS.escape(id)}"]`).value);
        if (!day) return toast('Enter a publish day.');
        try {
          await api('/api/admin/levels/' + encodeURIComponent(id) + '/publish', {
            method: 'POST',
            body: JSON.stringify({ day }),
          });
          toast('Published.');
          await loadAdmin();
        } catch (e) {
          toast(e.message);
        }
      };
    });
  }

  loadAdmin();
})();
