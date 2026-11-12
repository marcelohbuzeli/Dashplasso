/* =====================================================================
   Plassô — interface compartilhada
   - Menu inferior (dock) com as 4 abas e a cor de cada uma
   - Sub-navegação da Empresa
   - Folha/modal (sobe de baixo no celular, centralizada no desktop)
   - Utilidades de formato e regras comuns de tarefas/eventos
   Carregue depois de core.js. Chame UI.mount({ tab, sub }) no topo do código da página.
   ===================================================================== */
(function () {
  'use strict';

  const TABS = [
    { id: 'home', href: 'index.html', icon: 'fa-house', label: 'Home', color: '#ff6d29', ink: '#ffffff' },
    { id: 'empresa', href: 'empresa.html', icon: 'fa-briefcase', label: 'Empresa', color: '#3d5bff', ink: '#ffffff' },
    { id: 'crm', href: 'crm.html', icon: 'fa-bullseye', label: 'CRM', color: '#fe2e4b', ink: '#ffffff' },
    { id: 'fin', href: 'finance.html', icon: 'fa-wallet', label: 'Financeiro', color: '#2bf0b4', ink: '#03140e' }
  ];
  const EMPRESA_SUB = [
    { id: 'geral', href: 'empresa.html', label: 'Visão geral', icon: 'fa-chart-simple' },
    { id: 'tasks', href: 'tasks.html', label: 'Tasks', icon: 'fa-list-check' },
    { id: 'calendario', href: 'calendar.html', label: 'Calendário', icon: 'fa-calendar' },
    { id: 'clientes', href: 'clients.html', label: 'Clientes', icon: 'fa-user-group' },
    { id: 'criacao', href: 'criacao.html', label: 'Criação IA', icon: 'fa-wand-magic-sparkles' }
  ];

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // em localhost, mantém ?local=1&demo=1 ao navegar (só para testes)
  function keepParams(href) {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return href;
    const q = new URLSearchParams(location.search);
    const keep = new URLSearchParams();
    ['local', 'demo'].forEach(k => { if (q.has(k)) keep.set(k, q.get(k)); });
    const s = keep.toString();
    if (!s) return href;
    return href + (href.includes('?') ? '&' : '?') + s;
  }

  function mount({ tab = 'home', sub = null } = {}) {
    document.body.dataset.theme = tab;
    // dock
    if (!document.querySelector('.dock')) {
      const nav = document.createElement('nav');
      nav.className = 'dock';
      nav.setAttribute('aria-label', 'Navegação principal');
      nav.innerHTML = TABS.map(t => `
        <a href="${keepParams(t.href)}" class="${t.id === tab ? 'on' : ''}" style="--tab:${t.color};--tab-ink:${t.ink}" aria-label="${t.label}" ${t.id === tab ? 'aria-current="page"' : ''}>
          <i class="fa-solid ${t.icon}"></i><span>${t.label}</span>
        </a>`).join('');
      document.body.appendChild(nav);
    }
    // sub-navegação da empresa
    const slot = document.getElementById('subnav');
    if (slot && tab === 'empresa') {
      slot.className = 'seg subnav';
      slot.innerHTML = EMPRESA_SUB.map(s => `<a href="${keepParams(s.href)}" class="${s.id === sub ? 'on' : ''}"><i class="fa-solid ${s.icon}"></i>${s.label}</a>`).join('');
      const on = slot.querySelector('.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
    document.querySelectorAll('a[data-keep]').forEach(a => a.href = keepParams(a.getAttribute('href')));
  }

  // ---------- folha / modal ----------
  let openSheets = 0;
  function sheet({ title = '', html = '', foot = '', wide = false, onClose = null } = {}) {
    const back = document.createElement('div');
    back.className = 'sheet-back';
    back.innerHTML = `
      <div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="grab"></div>
        <div class="sheet-head"><h2 class="h2">${title}</h2><button class="chip-btn" data-close aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="sheet-body">${html}</div>
        ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
      </div>`;
    document.body.appendChild(back);
    openSheets++;
    document.documentElement.style.overflow = 'hidden';
    requestAnimationFrame(() => back.classList.add('open'));
    const close = () => {
      if (!back.isConnected) return;
      back.classList.remove('open');
      setTimeout(() => back.remove(), 200);
      openSheets = Math.max(0, openSheets - 1);
      if (!openSheets) document.documentElement.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      onClose && onClose();
    };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', e => { if (e.target === back) close(); });
    back.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    const el = back.querySelector('.sheet');
    const first = el.querySelector('input:not([type=hidden]):not([readonly]), textarea, select');
    if (first && window.matchMedia('(min-width: 768px)').matches) setTimeout(() => first.focus(), 120);
    return { el, close, $: sel => el.querySelector(sel), $$: sel => [...el.querySelectorAll(sel)] };
  }

  // lê os campos [name] de um container como objeto
  function formData(root) {
    const o = {};
    root.querySelectorAll('[name]').forEach(i => {
      if (i.type === 'checkbox') o[i.name] = i.checked;
      else if (i.type === 'radio') { if (i.checked) o[i.name] = i.value; }
      else o[i.name] = i.value;
    });
    return o;
  }

  // ---------- formatos ----------
  const hoje = () => new Date().toLocaleDateString('sv-SE');
  const agoraHM = () => new Date().toTimeString().slice(0, 5);
  const brl = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const brlParts = v => { const s = (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); const i = s.lastIndexOf(','); return { int: s.slice(0, i), cents: s.slice(i) }; };
  const dataBR = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
  const diaMes = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
  const dias = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
  const addDias = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
  const mesNome = key => { const [y, m] = key.split('-').map(Number); const t = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
  const diaSemana = iso => new Date(iso + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  const quando = iso => {
    if (!iso) return 'sem data';
    const d = dias(hoje(), iso);
    if (d === 0) return 'hoje'; if (d === 1) return 'amanhã'; if (d === -1) return 'ontem';
    if (d < 0) return `${-d} dias atrás`; if (d < 7) return diaSemana(iso) + ' · ' + diaMes(iso);
    return diaMes(iso);
  };
  const saudacao = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };
  const iniciais = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();

  // ---------- regras de tarefas / eventos (coleção "tasks" + "events" antigos) ----------
  const STATUS = [
    { id: 'urgent', label: 'Urgente', pill: 'pill-danger' },
    { id: 'afazer', label: 'A fazer', pill: '' },
    { id: 'pronto', label: 'Pronto', pill: 'pill-warn' },
    { id: 'aprovadas', label: 'Aprovado', pill: 'pill-ok' }
  ];
  const FORMATOS = ['Reels', 'Carrossel', 'Story', 'Foto Única', 'Estático', 'Vídeo'];
  const T = {
    kind(t) {
      if (t.kind) return t.kind;
      if (t.notes === 'crm_meeting') return 'reuniao';
      if (t.notes === 'crm_follow') return 'follow';
      if (t.notes === 'crm_evento') return 'evento';
      return 'post';
    },
    isConteudo(t) { return T.kind(t) === 'post'; },
    hora(t) {
      if (t.time) return t.time;
      const m = (t.headline || '').match(/\[(\d{1,2})(?:h|:)(\d{2})?\]/) || (t.caption || '').match(/às (\d{1,2}):(\d{2})/);
      return m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : '';
    },
    titulo(t) {
      let s = (t.headline || t.title || t.client || 'Sem título').replace(/^\[[^\]]+\]\s*/, '');
      const f = s.match(/^Follow Up: Follow \((.*)\)$/i);
      if (f) s = 'Follow-up com ' + f[1];
      return s;
    },
    // status efetivo (mesma regra do kanban antigo: vence em até 48h ou reprovado = urgente)
    status(t) {
      if (t.status === 'aprovadas' || t.status === 'approved') return 'aprovadas';
      if (t.status === 'pronto') return 'pronto';
      if (t.isRejected) return 'urgent';
      if (t.manuallyMovedToPronto) return t.status || 'afazer';
      if (t.date) {
        const h = (new Date(t.date + 'T23:59:59') - new Date()) / 36e5;
        if (h <= 48) return 'urgent';
      }
      return t.status === 'urgent' && !t.date ? 'urgent' : 'afazer';
    },
    statusInfo(id) { return STATUS.find(s => s.id === id) || STATUS[1]; },
    conteudos() { return DB.list('tasks').filter(T.isConteudo); },
    // tudo que aparece no calendário (tarefas + eventos antigos)
    itensCalendario() {
      const ts = DB.list('tasks').filter(t => t.date).map(t => ({ ...t, _src: 'tasks', _kind: T.kind(t), _hora: T.hora(t), _titulo: T.titulo(t) }));
      const ev = DB.list('events').filter(e => e.date).map(e => ({ ...e, _src: 'events', _kind: 'evento', _hora: e.time || '', _titulo: e.title || 'Evento' }));
      return [...ts, ...ev];
    },
    compromissosDoDia(iso) {
      return T.itensCalendario().filter(i => i.date === iso && i._kind !== 'post').sort((a, b) => (a._hora || '99').localeCompare(b._hora || '99'));
    },
    novoId() { return 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
    kindInfo(k) {
      return ({ post: { label: 'Conteúdo', icon: 'fa-clapperboard' }, reuniao: { label: 'Reunião', icon: 'fa-handshake' }, follow: { label: 'Follow-up', icon: 'fa-phone' }, evento: { label: 'Evento', icon: 'fa-calendar-day' } })[k] || { label: 'Item', icon: 'fa-circle' };
    }
  };

  // menu da conta (todas as páginas)
  function menu() {
    const s = sheet({
      title: 'Menu',
      html: `<div class="list">
        <a class="item" href="${keepParams('lancar.html')}"><div class="icon accent"><i class="fa-solid fa-plus"></i></div><div class="grow"><div class="title">Lançar gasto rápido</div><div class="sub">Abre o lançamento do financeiro</div></div></a>
        <a class="item" href="${keepParams('criacao.html')}"><div class="icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div><div class="grow"><div class="title">Agente de criação</div><div class="sub">Conteúdos com IA a partir do briefing</div></div></a>
        <button class="item item-btn" id="m-backup"><div class="icon"><i class="fa-solid fa-download"></i></div><div class="grow"><div class="title">Baixar backup</div><div class="sub">Arquivo com todos os seus dados</div></div></button>
        ${window.App && App.configured ? `<button class="item item-btn" id="m-sair"><div class="icon"><i class="fa-solid fa-right-from-bracket"></i></div><div class="grow"><div class="title">Sair</div><div class="sub">${esc((App.user && App.user.email) || '')}</div></div></button>` : ''}
      </div>`
    });
    s.$('#m-backup').onclick = () => { App.exportBackup(); s.close(); };
    const sair = s.$('#m-sair'); if (sair) sair.onclick = () => App.logout();
  }

  window.UI = { mount, sheet, menu, formData, esc, keepParams, TABS, hoje, agoraHM, brl, brlParts, dataBR, diaMes, dias, addDias, mesNome, diaSemana, quando, saudacao, iniciais, STATUS, FORMATOS, T };
})();
