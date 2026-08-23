import {
  auth, db, secondaryAuth, usernameToEmail,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  ref, set, get, update, push, remove, onValue, off, serverTimestamp,
} from './firebase-init.js';
 
const state = {
  uid: null,
  profile: null,        // { username, role, parentId }
  servers: {},           // id -> server object (only ones I can see)
  subusers: {},          // uid -> { username }
  currentServerId: null,
  consoleUnsub: null,
  serverListListeners: [],
};

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- Boot / auth state ----------------

onAuthStateChanged(auth, async (user) => {
  if (user) {
    state.uid = user.uid;
    const snap = await get(ref(db, `users/${user.uid}`));
    if (!snap.exists()) {
      // Auth account exists but no profile row (shouldn't normally happen) — sign out to be safe.
      await signOut(auth);
      showAuth();
      return;
    }
    state.profile = snap.val();
    await showApp();
  } else {
    state.uid = null;
    state.profile = null;
    teardownListeners();
    showAuth();
  }
});

function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
}

async function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  document.getElementById('me-username').textContent = state.profile.username;
  document.getElementById('me-role').textContent = state.profile.role;
  document.getElementById('nav-subusers').classList.toggle('hidden', state.profile.role === 'subuser');
  watchAgentStatus();
  watchServers();
  showView('servers');
}

function teardownListeners() {
  state.serverListListeners.forEach((fn) => fn());
  state.serverListListeners = [];
  if (state.consoleUnsub) { state.consoleUnsub(); state.consoleUnsub = null; }
}

// ---------------- Auth forms ----------------

document.getElementById('show-register').onclick = () => {
  document.getElementById('auth-form-login').classList.add('hidden');
  document.getElementById('auth-form-register').classList.remove('hidden');
};
document.getElementById('show-login').onclick = () => {
  document.getElementById('auth-form-register').classList.add('hidden');
  document.getElementById('auth-form-login').classList.remove('hidden');
};

document.getElementById('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const errEl = document.getElementById('auth-error');
  errEl.classList.add('hidden');
  try {
    await signInWithEmailAndPassword(auth, usernameToEmail(f.get('username')), f.get('password'));
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
    errEl.classList.remove('hidden');
  }
};

document.getElementById('register-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const username = f.get('username').trim();
  const password = f.get('password');
  const errEl = document.getElementById('auth-error-2');
  errEl.classList.add('hidden');
  try {
    const cred = await createUserWithEmailAndPassword(auth, usernameToEmail(username), password);
    await set(ref(db, `users/${cred.user.uid}`), {
      username, role: 'owner', parentId: null, createdAt: serverTimestamp(),
    });
    // onAuthStateChanged fires automatically and loads the app.
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
    errEl.classList.remove('hidden');
  }
};

function friendlyAuthError(err) {
  const code = err.code || '';
  if (code.includes('email-already-in-use')) return 'That username is already taken';
  if (code.includes('wrong-password') || code.includes('invalid-credential') || code.includes('user-not-found')) return 'Incorrect username or password';
  if (code.includes('weak-password')) return 'Password must be at least 8 characters';
  return err.message || 'Something went wrong';
}

document.getElementById('logout-btn').onclick = () => signOut(auth);

// ---------------- Nav ----------------

document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
  btn.onclick = () => showView(btn.dataset.view);
});

function showView(name) {
  if (state.consoleUnsub) { state.consoleUnsub(); state.consoleUnsub = null; }
  document.querySelectorAll('.nav-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.getElementById('view-servers').classList.toggle('hidden', name !== 'servers');
  document.getElementById('view-server-detail').classList.add('hidden');
  document.getElementById('view-subusers').classList.toggle('hidden', name !== 'subusers');
  if (name === 'subusers') watchSubusers();
  if (name === 'servers') renderServerGrid();
}

// ---------------- Agent heartbeat ----------------

function watchAgentStatus() {
  const cb = onValue(ref(db, 'agentStatus'), (snap) => {
    const agents = snap.val() || {};
    const now = Date.now();
    const anyRecent = Object.values(agents).some((a) => a.lastSeen && now - a.lastSeen < 60000);
    document.getElementById('agent-warning').classList.toggle('hidden', anyRecent);
  });
  state.serverListListeners.push(() => off(ref(db, 'agentStatus'), 'value', cb));
}

// ---------------- Servers ----------------

function watchServers() {
  // Servers I own
  const ownedRef = ref(db, 'servers');
  const cb = onValue(ownedRef, (snap) => {
    const all = snap.val() || {};
    const visible = {};
    for (const [id, s] of Object.entries(all)) {
      if (s.ownerId === state.uid) visible[id] = { id, ...s };
    }
    // merge with any sub-user-permitted servers already known (handled below via permissions listener)
    state.servers = { ...state.servers, ...visible };
    // drop owned ones that disappeared
    for (const id of Object.keys(state.servers)) {
      if (!all[id]) delete state.servers[id];
    }
    renderServerGrid();
    if (state.currentServerId && all[state.currentServerId]) {
      renderServerDetail({ id: state.currentServerId, ...all[state.currentServerId] });
    } else if (state.currentServerId && !all[state.currentServerId]) {
      showView('servers');
    }
  });
  state.serverListListeners.push(() => off(ownedRef, 'value', cb));

  // If I'm a sub-user, also load servers I've been granted access to via my permission rows.
  if (state.profile.role === 'subuser') {
    // We don't have a direct index of "servers I can access" without reading each server,
    // so rules allow read of a server doc as soon as a permissions/$serverId/$myUid node exists.
    // The simplest client approach: listen to permissions nodes we know about from server cards
    // the owner has shared the id for, OR — more robustly — the owner's app writes a mirror index.
    const idxRef = ref(db, `subuserServerIndex/${state.uid}`);
    const idxCb = onValue(idxRef, async (snap) => {
      const ids = Object.keys(snap.val() || {});
      for (const id of ids) {
        const s = await get(ref(db, `servers/${id}`));
        if (s.exists()) state.servers[id] = { id, ...s.val() };
      }
      renderServerGrid();
    });
    state.serverListListeners.push(() => off(idxRef, 'value', idxCb));
  }
}

function beaconClass(s) {
  if (s.status === 'running') return 'running';
  if (s.status === 'starting' || s.startRequested) return 'starting';
  return 'off';
}

function renderServerGrid() {
  const grid = document.getElementById('server-grid');
  const list = Object.values(state.servers);
  grid.innerHTML = '';
  if (!list.length) {
    grid.appendChild(el(`<div class="empty-state" style="grid-column:1/-1">
      <h3>No servers yet</h3>
      <p>Create a server, point it at a jar download URL, then request a start.</p>
    </div>`));
    return;
  }
  for (const s of list) {
    const card = el(`
      <div class="server-card">
        <div class="row"><div class="beacon ${beaconClass(s)}"></div><h3>${escapeHtml(s.name)}</h3></div>
        <div class="server-meta">
          <span>${s.status || 'stopped'}</span>
          <span>${s.ramMb} MB</span>
          <span>${s.jarDownloadUrl ? 'Jar linked' : 'No jar URL yet'}</span>
        </div>
        ${s.playitAddress ? `<div class="server-addr">${escapeHtml(s.playitAddress)}</div>` : ''}
      </div>`);
    card.onclick = () => openServerDetail(s.id);
    grid.appendChild(card);
  }
}

document.getElementById('new-server-btn').onclick = () => openModal(newServerModal());

function newServerModal() {
  const wrap = el(`
    <div class="modal-backdrop">
      <div class="modal">
        <h2>New server</h2>
        <div id="ns-error" class="error-msg hidden"></div>
        <div class="field"><label>Server name</label><input id="ns-name" type="text" placeholder="Survival SMP" required></div>
        <div class="field"><label>Memory allocation (MB)</label><input id="ns-ram" type="number" value="2048" min="512" max="32768"></div>
        <div class="btn-row">
          <button class="btn btn-primary" id="ns-create">Create server</button>
          <button class="btn" id="ns-cancel">Cancel</button>
        </div>
      </div>
    </div>`);
  wrap.querySelector('#ns-cancel').onclick = closeModal;
  wrap.querySelector('#ns-create').onclick = async () => {
    const name = wrap.querySelector('#ns-name').value.trim();
    const ramMb = parseInt(wrap.querySelector('#ns-ram').value, 10);
    const errEl = wrap.querySelector('#ns-error');
    if (!name) { errEl.textContent = 'Server name is required'; errEl.classList.remove('hidden'); return; }
    try {
      const newRef = push(ref(db, 'servers'));
      await set(newRef, {
        ownerId: state.uid, name, ramMb, status: 'stopped', eulaAccepted: false,
        createdAt: serverTimestamp(),
      });
      closeModal();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  };
  return wrap;
}

function openModal(node) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  root.appendChild(node);
}
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

// ---------------- Server detail ----------------

async function openServerDetail(id) {
  state.currentServerId = id;
  document.getElementById('view-servers').classList.add('hidden');
  document.getElementById('view-subusers').classList.add('hidden');
  document.getElementById('view-server-detail').classList.remove('hidden');
  const snap = await get(ref(db, `servers/${id}`));
  if (!snap.exists()) { showView('servers'); return; }
  renderServerDetail({ id, ...snap.val() });
  watchConsole(id);
}

function watchConsole(id) {
  if (state.consoleUnsub) { state.consoleUnsub(); state.consoleUnsub = null; }
  const logsRef = ref(db, `consoleLogs/${id}`);
  const cb = onValue(logsRef, (snap) => {
    const out = document.getElementById('console-out');
    if (!out) return;
    const entries = Object.values(snap.val() || {}).sort((a, b) => (a.t || 0) - (b.t || 0));
    out.textContent = entries.map((e) => e.line).join('');
    out.scrollTop = out.scrollHeight;
  });
  state.consoleUnsub = () => off(logsRef, 'value', cb);
}

function renderServerDetail(s) {
  const detail = document.getElementById('view-server-detail');
  const isOwner = s.ownerId === state.uid;
  detail.innerHTML = '';
  const running = s.status === 'running';
  detail.appendChild(el(`
    <div class="page-head">
      <div>
        <button class="btn btn-sm" id="back-btn" style="margin-bottom:10px">← All servers</button>
        <h1><span class="beacon ${beaconClass(s)}" style="display:inline-block;vertical-align:middle;margin-right:8px"></span>${escapeHtml(s.name)}</h1>
        <p>${s.ramMb} MB allocated · status: ${s.status || 'stopped'}</p>
      </div>
      <div class="btn-row">
        ${!running ? `<button class="btn btn-primary" id="start-btn">▶ Request start</button>` : `<button class="btn btn-danger" id="stop-btn">■ Request stop</button>`}
        ${isOwner ? `<button class="btn btn-danger" id="delete-btn">Delete</button>` : ''}
      </div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="panel-box">
          <h2>Console</h2>
          <div class="console" id="console-out"></div>
          <div class="cmd-row">
            <input id="cmd-input" type="text" placeholder="${running ? 'Type a server command and press Enter…' : 'Server is stopped'}" ${running ? '' : 'disabled'}>
            <button class="btn btn-sm" id="cmd-send" ${running ? '' : 'disabled'}>Send</button>
          </div>
          <p class="hint">Updates live from your host agent. If nothing shows up after a start request, make sure the agent script is running on your host machine.</p>
        </div>
      </div>
      <div>
        ${!s.eulaAccepted ? `
        <div class="panel-box">
          <h2>Minecraft EULA</h2>
          <p style="font-size:12.5px;color:var(--text-muted);margin:0 0 10px">You must accept Mojang's EULA before this server can start.</p>
          <button class="btn btn-primary btn-block" id="eula-btn">I accept the Minecraft EULA</button>
        </div>` : ''}

        <div class="panel-box">
          <h2>Server jar</h2>
          <div class="field"><label>Direct download URL</label><input id="jar-url" type="text" placeholder="https://.../paper-1.21.jar" value="${escapeHtml(s.jarDownloadUrl || '')}"></div>
          <button class="btn btn-sm btn-block" id="jar-save-btn">Save & fetch on host</button>
          <p class="hint">Paste a direct .jar download link (e.g. from papermc.io/downloads). The host agent downloads it — nothing passes through Firebase.</p>
        </div>

        <div class="panel-box">
          <h2>playit.gg tunnel</h2>
          <div class="stat-line"><span>Status</span><span>${s.playitStatus || 'stopped'}</span></div>
          <div class="stat-line"><span>Public address</span><span class="mono">${escapeHtml(s.playitAddress || '—')}</span></div>
          <div class="btn-row" style="margin-top:12px">
            ${s.playitStatus !== 'running' ? `<button class="btn btn-primary btn-sm" id="playit-start-btn">Start playit.gg</button>` : `<button class="btn btn-danger btn-sm" id="playit-stop-btn">Stop</button>`}
          </div>
          <hr style="border-color:var(--border);margin:14px 0">
          <div class="field"><label>playit.gg secret key</label><input id="playit-secret-input" type="text" placeholder="paste secret key from playit.gg" value="${escapeHtml(s.playitSecret || '')}"></div>
          <button class="btn btn-sm btn-block" id="playit-secret-btn">Save secret key</button>
          <p class="hint">Get a secret key by creating a tunnel at <a href="https://playit.gg" target="_blank" rel="noopener">playit.gg</a>. The playit agent binary itself is installed once on your host machine (see agent/README.md) — no upload needed here.</p>
        </div>
      </div>
    </div>
  `));

  detail.querySelector('#back-btn').onclick = () => showView('servers');

  const startBtn = detail.querySelector('#start-btn');
  if (startBtn) startBtn.onclick = () => guarded(() => update(ref(db, `servers/${s.id}`), { startRequested: true }));
  const stopBtn = detail.querySelector('#stop-btn');
  if (stopBtn) stopBtn.onclick = () => guarded(() => update(ref(db, `servers/${s.id}`), { stopRequested: true }));
  const delBtn = detail.querySelector('#delete-btn');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm(`Delete "${s.name}"? This asks the host agent to remove its local files too.`)) return;
    await update(ref(db, `servers/${s.id}`), { deleteRequested: true });
    await remove(ref(db, `servers/${s.id}`));
    showView('servers');
  };
  const eulaBtn = detail.querySelector('#eula-btn');
  if (eulaBtn) eulaBtn.onclick = () => guarded(() => update(ref(db, `servers/${s.id}`), { eulaAccepted: true }));

  detail.querySelector('#jar-save-btn').onclick = () => guarded(async () => {
    const url = detail.querySelector('#jar-url').value.trim();
    if (!url) return alert('Paste a jar download URL first');
    await update(ref(db, `servers/${s.id}`), { jarDownloadUrl: url, jarFetchRequested: true });
  });

  detail.querySelector('#cmd-send').onclick = sendCommand;
  detail.querySelector('#cmd-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCommand(); });
  async function sendCommand() {
    const input = detail.querySelector('#cmd-input');
    const command = input.value.trim();
    if (!command) return;
    input.value = '';
    await guarded(() => push(ref(db, `commandQueue/${s.id}`), { command, requestedBy: state.uid, t: Date.now() }));
  }

  const playitStartBtn = detail.querySelector('#playit-start-btn');
  if (playitStartBtn) playitStartBtn.onclick = () => guarded(() => update(ref(db, `servers/${s.id}`), { playitStartRequested: true }));
  const playitStopBtn = detail.querySelector('#playit-stop-btn');
  if (playitStopBtn) playitStopBtn.onclick = () => guarded(() => update(ref(db, `servers/${s.id}`), { playitStopRequested: true }));
  detail.querySelector('#playit-secret-btn').onclick = () => guarded(async () => {
    const secret = detail.querySelector('#playit-secret-input').value.trim();
    if (!secret) return alert('Paste a secret key first');
    await update(ref(db, `servers/${s.id}`), { playitSecret: secret });
    alert('Secret key saved.');
  });
}

async function guarded(fn) {
  try { await fn(); }
  catch (err) { alert(err.message.includes('PERMISSION_DENIED') ? "You don't have permission to do that" : err.message); }
}

// ---------------- Sub-users ----------------

function watchSubusers() {
  // We keep a per-owner index at users/$ownerUid isn't queryable by parentId without an index,
  // so the owner maintains a small mirror at subusersOf/$ownerUid/$subUid on creation.
  const idxRef = ref(db, `subusersOf/${state.uid}`);
  onValue(idxRef, async (snap) => {
    const ids = Object.keys(snap.val() || {});
    state.subusers = {};
    for (const id of ids) {
      const u = await get(ref(db, `users/${id}`));
      if (u.exists()) state.subusers[id] = { id, ...u.val() };
    }
    renderSubusers();
  }, { onlyOnce: false });
}

function renderSubusers() {
  const list = document.getElementById('subuser-list');
  const items = Object.values(state.subusers);
  list.innerHTML = '';
  if (!items.length) {
    list.appendChild(el(`<div class="empty-state"><h3>No sub-users yet</h3><p>Add one to share access to specific servers without giving out your password.</p></div>`));
    return;
  }
  for (const su of items) {
    const row = el(`
      <div class="subuser-row">
        <div><strong>${escapeHtml(su.username)}</strong><div style="font-size:12px;color:var(--text-muted)">sub-user</div></div>
        <div class="btn-row">
          <button class="btn btn-sm" data-act="perms">Permissions</button>
          <button class="btn btn-danger btn-sm" data-act="del">Remove</button>
        </div>
      </div>`);
    row.querySelector('[data-act="perms"]').onclick = () => openModal(permissionsModal(su));
    row.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm(`Remove sub-user "${su.username}"? They'll lose all server access. (Their login account itself must be deleted separately from the Firebase console.)`)) return;
      await remove(ref(db, `subusersOf/${state.uid}/${su.id}`));
      // Also strip any server permissions they had.
      for (const sid of Object.keys(state.servers)) {
        await remove(ref(db, `permissions/${sid}/${su.id}`));
        await remove(ref(db, `subuserServerIndex/${su.id}/${sid}`));
      }
    };
    list.appendChild(row);
  }
}

document.getElementById('new-subuser-btn').onclick = () => openModal(newSubuserModal());

function newSubuserModal() {
  const wrap = el(`
    <div class="modal-backdrop">
      <div class="modal">
        <h2>Add sub-user</h2>
        <div id="su-error" class="error-msg hidden"></div>
        <div class="field"><label>Username</label><input id="su-username" type="text" minlength="3" required></div>
        <div class="field"><label>Password</label><input id="su-password" type="password" minlength="8" required></div>
        <p class="hint">After creating them, set which servers they can access under Permissions.</p>
        <div class="btn-row">
          <button class="btn btn-primary" id="su-create">Create</button>
          <button class="btn" id="su-cancel">Cancel</button>
        </div>
      </div>
    </div>`);
  wrap.querySelector('#su-cancel').onclick = closeModal;
  wrap.querySelector('#su-create').onclick = async () => {
    const username = wrap.querySelector('#su-username').value.trim();
    const password = wrap.querySelector('#su-password').value;
    const errEl = wrap.querySelector('#su-error');
    errEl.classList.add('hidden');
    try {
      // Created on the SECONDARY auth instance so the owner's own session is untouched.
      const cred = await createUserWithEmailAndPassword(secondaryAuth, usernameToEmail(username), password);
      const subUid = cred.user.uid;
      await set(ref(db, `users/${subUid}`), {
        username, role: 'subuser', parentId: state.uid, createdAt: serverTimestamp(),
      });
      await set(ref(db, `subusersOf/${state.uid}/${subUid}`), true);
      await signOut(secondaryAuth); // clean up the secondary session
      closeModal();
    } catch (err) {
      errEl.textContent = friendlyAuthError(err);
      errEl.classList.remove('hidden');
    }
  };
  return wrap;
}

function permissionsModal(su) {
  const servers = Object.values(state.servers).filter((s) => s.ownerId === state.uid);
  const wrap = el(`
    <div class="modal-backdrop">
      <div class="modal">
        <h2>${escapeHtml(su.username)}'s access</h2>
        <p class="hint">Choose a server, then tick what they're allowed to do.</p>
        <div class="field"><label>Server</label>
          <select id="pm-server" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:9px;color:var(--text)">
            ${servers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="perm-grid" id="pm-perms">
          ${['canStart:Start', 'canStop:Stop', 'canConsole:View console', 'canCommand:Send commands', 'canUpload:Set/fetch jar', 'canManagePlayit:Manage playit.gg', 'canDelete:Delete server']
            .map((p) => { const [k, label] = p.split(':'); return `<label class="perm-check"><input type="checkbox" data-perm="${k}"> ${label}</label>`; }).join('')}
        </div>
        <div class="btn-row" style="margin-top:16px">
          <button class="btn btn-primary" id="pm-save">Save permissions</button>
          <button class="btn" id="pm-cancel">Close</button>
        </div>
      </div>
    </div>`);
  wrap.querySelector('#pm-cancel').onclick = closeModal;
  wrap.querySelector('#pm-save').onclick = async () => {
    const serverId = wrap.querySelector('#pm-server').value;
    if (!serverId) return;
    const body = {};
    wrap.querySelectorAll('[data-perm]').forEach((cb) => { body[cb.dataset.perm] = cb.checked; });
    try {
      await set(ref(db, `permissions/${serverId}/${su.id}`), body);
      await set(ref(db, `subuserServerIndex/${su.id}/${serverId}`), true);
      closeModal();
    } catch (err) { alert(err.message); }
  };
  return wrap;
}
