/* =====================================================================
   Plassô — núcleo compartilhado
   - Login (Supabase Auth)
   - Store: substitui o localStorage. Carrega tudo do banco ao abrir a
     página, mantém em memória e salva cada alteração no banco.
   - Menu lateral único para todos os sistemas
   - Backup em JSON e importação dos dados antigos do navegador

   Uso numa página:
     <script src="assets/config.js"></script>
     <script src="assets/core.js" data-mode="app"></script>   (app | portal | public)
     <script type="text/plain" data-app> ...código da página... </script>
   O código da página só roda depois que os dados chegaram.
   ===================================================================== */
(function () {
  'use strict';

  const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/dist/umd/supabase.min.js';
  const cfg = window.PLASSO_CONFIG || {};
  const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const me = document.currentScript;
  const MODE = (me && me.dataset.mode) || 'app';

  let sb = null;            // cliente supabase
  let user = null;
  let portalToken = null;
  const cache = {};         // collection -> array de objetos (ou {__scalar: valor})
  const snap = {};          // collection -> Map(id -> json) último estado salvo
  let queue = Promise.resolve();
  let pending = 0;

  // ---------- utilidades ----------
  const keyToCol = k => String(k).replace(/^plasso_/, '');
  const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function randomToken(len = 32) {
    const a = new Uint8Array(len);
    crypto.getRandomValues(a);
    return Array.from(a, b => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('');
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Falha ao carregar ' + src));
      document.head.appendChild(s);
    });
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- indicador / toasts ----------
  function ui() {
    if (document.getElementById('plasso-ui')) return;
    const d = document.createElement('div');
    d.id = 'plasso-ui';
    d.innerHTML = `
      <div id="plasso-loading" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#030712;color:#94a3b8;font:500 13px 'Plus Jakarta Sans',system-ui,sans-serif;gap:10px">
        <span style="width:14px;height:14px;border:2px solid #1f2937;border-top-color:#3b82f6;border-radius:50%;animation:plassospin .8s linear infinite"></span>
        <span id="plasso-loading-text">Carregando dados…</span>
      </div>
      <div id="plasso-save" style="position:fixed;right:14px;bottom:14px;z-index:9998;font:500 11px ui-monospace,monospace;padding:6px 10px;border-radius:999px;background:#0b0f19;border:1px solid #1f2937;color:#64748b;opacity:0;transition:opacity .3s;pointer-events:none"></div>
      <div id="plasso-toasts" style="position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:10000;display:flex;flex-direction:column;gap:8px;align-items:center"></div>
      <style>@keyframes plassospin{to{transform:rotate(360deg)}}</style>`;
    document.body.appendChild(d);
  }
  function hideLoading() { const l = document.getElementById('plasso-loading'); if (l) l.remove(); }
  function setLoadingText(t) { const l = document.getElementById('plasso-loading-text'); if (l) l.textContent = t; }
  function saveBadge(state) {
    const b = document.getElementById('plasso-save'); if (!b) return;
    if (state === 'saving') { b.textContent = '● salvando…'; b.style.color = '#f59e0b'; b.style.opacity = 1; }
    else if (state === 'saved') { b.textContent = '✓ salvo'; b.style.color = '#10b981'; b.style.opacity = 1; setTimeout(() => { if (!pending) b.style.opacity = 0; }, 1500); }
    else if (state === 'local') { b.textContent = 'modo local (sem banco)'; b.style.color = '#f59e0b'; b.style.opacity = 1; }
  }
  function toast(msg, type = 'info') {
    const box = document.getElementById('plasso-toasts'); if (!box) { alert(msg); return; }
    const colors = { info: '#3b82f6', ok: '#10b981', err: '#ef4444', warn: '#f59e0b' };
    const t = document.createElement('div');
    t.style.cssText = `background:#0b0f19;border:1px solid ${colors[type] || colors.info};color:#e2e8f0;padding:10px 16px;border-radius:12px;font:500 13px 'Plus Jakarta Sans',system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4);max-width:90vw`;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), type === 'err' ? 7000 : 3500);
  }

  // ---------- persistência ----------
  function enqueue(fn) {
    pending++; saveBadge('saving');
    queue = queue.then(fn).catch(e => {
      console.error(e);
      toast('Erro ao salvar no banco: ' + (e.message || e), 'err');
    }).finally(() => { pending--; if (!pending) saveBadge('saved'); });
    return queue;
  }

  function isCollectionArray(v) {
    return Array.isArray(v) && v.every(x => x && typeof x === 'object' && !Array.isArray(x) && x.id != null);
  }

  // Calcula o que mudou numa coleção e envia ao banco.
  function syncCollection(col) {
    const val = cache[col];
    const prev = snap[col] || new Map();
    const next = new Map();
    const upserts = [];
    const deletes = [];

    if (val && val.__scalar !== undefined) {
      const j = JSON.stringify({ v: val.__scalar });
      next.set('__value', j);
      if (prev.get('__value') !== j) upserts.push({ collection: col, id: '__value', data: { v: val.__scalar } });
      for (const id of prev.keys()) if (id !== '__value') deletes.push(id);
    } else {
      for (const item of (val || [])) {
        const id = String(item.id);
        const j = JSON.stringify(item);
        next.set(id, j);
        if (prev.get(id) !== j) upserts.push({ collection: col, id, data: item });
      }
      for (const id of prev.keys()) if (!next.has(id)) deletes.push(id);
    }
    snap[col] = next;
    if (!upserts.length && !deletes.length) return;

    if (!configured) { localStorage.setItem('plasso_' + col, val && val.__scalar !== undefined ? String(val.__scalar) : JSON.stringify(val)); return; }

    if (MODE === 'portal') {
      // no portal só alteramos tarefas existentes, campo a campo
      if (col !== 'tasks') return;
      const prevObjs = new Map([...prev].map(([k, v]) => [k, JSON.parse(v)]));
      upserts.forEach(u => {
        const old = prevObjs.get(u.id) || {};
        const patch = {};
        Object.keys(u.data).forEach(k => { if (JSON.stringify(u.data[k]) !== JSON.stringify(old[k])) patch[k] = u.data[k]; });
        if (Object.keys(patch).length) enqueue(async () => {
          const { error } = await sb.rpc('portal_update', { p_token: portalToken, p_task_id: u.id, p_patch: patch });
          if (error) throw error;
        });
      });
      return;
    }

    enqueue(async () => {
      for (let i = 0; i < upserts.length; i += 200) {
        const rows = upserts.slice(i, i + 200).map(r => ({ ...r, owner: user.id, updated_at: new Date().toISOString() }));
        const { error } = await sb.from('records').upsert(rows, { onConflict: 'owner,collection,id' });
        if (error) throw error;
      }
      if (deletes.length) {
        const { error } = await sb.from('records').delete().eq('collection', col).in('id', deletes);
        if (error) throw error;
      }
    });
  }

  function primeSnapshot(col) {
    const val = cache[col];
    const m = new Map();
    if (val && val.__scalar !== undefined) m.set('__value', JSON.stringify({ v: val.__scalar }));
    else (val || []).forEach(it => m.set(String(it.id), JSON.stringify(it)));
    snap[col] = m;
  }

  // ---------- API compatível com localStorage ----------
  const Store = {
    getItem(key) {
      const col = keyToCol(key);
      const v = cache[col];
      if (v === undefined) return null;
      if (v.__scalar !== undefined) return v.__scalar == null ? null : String(v.__scalar);
      return JSON.stringify(v);
    },
    setItem(key, str) {
      const col = keyToCol(key);
      let parsed;
      try { parsed = JSON.parse(str); } catch (e) { parsed = undefined; }
      if (isCollectionArray(parsed)) cache[col] = parsed;
      else cache[col] = { __scalar: String(str) };
      syncCollection(col);
    },
    removeItem(key) { const col = keyToCol(key); cache[col] = []; syncCollection(col); }
  };

  // ---------- API para código novo ----------
  const DB = {
    list(col) { const v = cache[col]; return Array.isArray(v) ? v : []; },
    get(col, id) { return DB.list(col).find(x => String(x.id) === String(id)) || null; },
    put(col, obj) {
      if (!Array.isArray(cache[col])) cache[col] = [];
      if (obj.id == null) obj.id = uid(col.slice(0, 2) + '_');
      const i = cache[col].findIndex(x => String(x.id) === String(obj.id));
      if (i >= 0) cache[col][i] = obj; else cache[col].push(obj);
      syncCollection(col);
      return obj;
    },
    putMany(col, objs) {
      if (!Array.isArray(cache[col])) cache[col] = [];
      objs.forEach(obj => {
        if (obj.id == null) obj.id = uid(col.slice(0, 2) + '_');
        const i = cache[col].findIndex(x => String(x.id) === String(obj.id));
        if (i >= 0) cache[col][i] = obj; else cache[col].push(obj);
      });
      syncCollection(col);
      return objs;
    },
    remove(col, id) {
      cache[col] = DB.list(col).filter(x => String(x.id) !== String(id));
      syncCollection(col);
    },
    removeWhere(col, fn) { cache[col] = DB.list(col).filter(x => !fn(x)); syncCollection(col); },
    getValue(col, fallback = null) { const v = cache[col]; return v && v.__scalar !== undefined ? JSON.parse(v.__scalar) : fallback; },
    setValue(col, value) { cache[col] = { __scalar: JSON.stringify(value) }; syncCollection(col); },
    flush() { return queue; }
  };

  // ---------- carregamento ----------
  async function loadAll() {
    let from = 0; const size = 1000;
    for (;;) {
      const { data, error } = await sb.from('records').select('collection,id,data').order('collection').range(from, from + size - 1);
      if (error) throw error;
      data.forEach(r => {
        if (r.id === '__value') cache[r.collection] = { __scalar: r.data.v };
        else (cache[r.collection] = Array.isArray(cache[r.collection]) ? cache[r.collection] : []).push(r.data);
      });
      if (data.length < size) break;
      from += size;
    }
    Object.keys(cache).forEach(primeSnapshot);
  }

  function loadLocal() {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k.startsWith('plasso_')) continue;
      const raw = localStorage.getItem(k);
      let p; try { p = JSON.parse(raw); } catch (e) { p = undefined; }
      cache[keyToCol(k)] = isCollectionArray(p) ? p : { __scalar: raw };
    }
    Object.keys(cache).forEach(primeSnapshot);
  }

  // dados antigos que estavam só no navegador -> banco (uma vez)
  async function offerMigration() {
    const hasRemote = Object.keys(cache).length > 0;
    const localKeys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('plasso_')) localKeys.push(k); }
    if (hasRemote || !localKeys.length || localStorage.getItem('__plasso_migrated')) return;
    if (!confirm(`Encontrei dados antigos salvos neste navegador (${localKeys.length} grupos: ${localKeys.join(', ')}).\n\nQuer enviar tudo para o banco de dados seguro agora?`)) return;
    setLoadingText('Enviando dados antigos para o banco…');
    localKeys.forEach(k => Store.setItem(k, localStorage.getItem(k)));
    await queue;
    localStorage.setItem('__plasso_migrated', new Date().toISOString());
    toast('Dados antigos importados para o banco.', 'ok');
  }

  // ---------- menu lateral único ----------
  const NAV = [
    { group: 'Gestão' },
    { href: 'index.html', icon: 'fa-chart-pie', label: 'Dashboard' },
    { href: 'tasks.html', icon: 'fa-list-check', label: 'Tasks' },
    { href: 'clients.html', icon: 'fa-network-wired', label: 'Clientes' },
    { href: 'calendar.html', icon: 'fa-calendar-days', label: 'Calendário' },
    { href: 'criacao.html', icon: 'fa-wand-magic-sparkles', label: 'Criação (IA)' },
    { group: 'Comercial' },
    { href: 'crm.html', icon: 'fa-users-viewfinder', label: 'CRM' },
    { group: 'Financeiro' },
    { href: 'finance.html', icon: 'fa-wallet', label: 'Financeiro' },
    { group: 'Pessoal' },
    { href: 'pessoal.html', icon: 'fa-seedling', label: 'Crescimento' }
  ];
  function renderNav() {
    const nav = document.querySelector('#sidebar nav');
    if (!nav) return;
    const here = (location.pathname.split('/').pop() || 'index.html');
    nav.innerHTML = NAV.map(n => n.group
      ? `<div class="sidebar-text px-3.5 pt-4 pb-1 text-[9px] uppercase tracking-[0.2em] text-slate-600 font-mono">${n.group}</div>`
      : `<a href="${n.href}" class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition text-left ${here === n.href ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200 hover:bg-dark-800/40'}">
           <i class="fa-solid ${n.icon} w-5 text-center text-sm shrink-0"></i><span class="sidebar-text tracking-wide whitespace-nowrap">${n.label}</span></a>`
    ).join('') + `
      <div class="sidebar-text px-3.5 pt-6 pb-1 text-[9px] uppercase tracking-[0.2em] text-slate-600 font-mono">Conta</div>
      <button onclick="App.exportBackup()" class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-dark-800/40 text-left"><i class="fa-solid fa-download w-5 text-center text-sm"></i><span class="sidebar-text">Backup (JSON)</span></button>
      ${configured ? `<button onclick="App.logout()" class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-slate-400 hover:text-red-300 hover:bg-dark-800/40 text-left"><i class="fa-solid fa-right-from-bracket w-5 text-center text-sm"></i><span class="sidebar-text">Sair</span></button>` : ''}`;
  }

  // ---------- executar o código da página ----------
  function runPageScripts() {
    const before = window.onload;
    document.querySelectorAll('script[type="text/plain"][data-app]').forEach(old => {
      const s = document.createElement('script');
      s.textContent = old.textContent;
      old.replaceWith(s);
    });
    if (window.onload && window.onload !== before && document.readyState === 'complete') {
      try { window.onload(); } catch (e) { console.error(e); }
    }
  }

  // ---------- boot ----------
  async function boot() {
    ui();
    try {
      if (!configured) {
        if (MODE === 'portal') { setLoadingText('Portal indisponível: banco de dados não configurado.'); return; }
        loadLocal();
        saveBadge('local');
      } else {
        if (!window.supabase) await loadScript(SUPABASE_CDN);
        sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

        if (MODE === 'portal') {
          portalToken = new URLSearchParams(location.search).get('t');
          const { data, error } = await sb.rpc('portal_load', { p_token: portalToken });
          if (error || !data) { setLoadingText('Link inválido ou expirado. Peça um novo link à agência.'); return; }
          cache.clients = [data.client];
          cache.tasks = data.tasks || [];
          primeSnapshot('clients'); primeSnapshot('tasks');
        } else if (MODE === 'app') {
          // links de convite / nova senha / login por e-mail caem aqui: a tela de login trata
          if (/type=(invite|recovery|magiclink|signup)|error_description=/.test(location.hash)) { location.replace('login.html' + location.hash); return; }
          const { data: { session } } = await sb.auth.getSession();
          if (!session) { location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search)); return; }
          user = session.user;
          await loadAll();
          await offerMigration();
        }
      }
      if (MODE === 'app') renderNav();
      runPageScripts();
    } catch (e) {
      console.error(e);
      setLoadingText('Erro: ' + (e.message || e));
      return;
    }
    hideLoading();
  }

  window.addEventListener('beforeunload', e => { if (pending) { e.preventDefault(); e.returnValue = ''; } });

  window.App = {
    Store, DB, toast, esc, uid, randomToken,
    get supabase() { return sb; },
    get user() { return user; },
    get configured() { return configured; },
    mode: MODE,
    async logout() { await queue; if (sb) await sb.auth.signOut(); location.replace('login.html'); },
    exportBackup() {
      const out = {};
      Object.keys(cache).forEach(k => { out[k] = cache[k] && cache[k].__scalar !== undefined ? cache[k].__scalar : cache[k]; });
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), data: out }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'plasso-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };
  window.Store = Store;
  window.DB = DB;

  if (MODE !== 'public') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})();
