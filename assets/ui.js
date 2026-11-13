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
    { id: 'aprovacao', href: 'aprovacao.html', label: 'Aprovação', icon: 'fa-circle-check' },
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
    { id: 'aprovadas', label: 'Aprovado', pill: 'pill-ok' },
    { id: 'postado', label: 'Postado', pill: 'pill-post' }
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
      if (t.status === 'postado') return 'postado';
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
    // conteúdo completo = tem o link do Drive com a versão final (só esses vão para o cliente aprovar)
    completo(t) { return !!(String(t.drive || '').trim() || (t.midias || []).length); },
    // está com o cliente para aprovar agora
    paraCliente(t) { return T.status(t) === 'pronto' && !t.isRejected && T.completo(t); },
    encerrado(t) { const s = T.status(t); return s === 'aprovadas' || s === 'postado'; },
    statusInfo(id) { return STATUS.find(s => s.id === id) || STATUS[1]; },
    conteudos() { return DB.list('tasks').filter(T.isConteudo); },
    // tudo que aparece no calendário (tarefas + eventos antigos)
    itensCalendario() {
      const ts = DB.list('tasks').filter(t => t.date).map(t => ({ ...t, _src: 'tasks', _kind: T.kind(t), _hora: T.hora(t), _titulo: T.titulo(t) }));
      const ev = DB.list('events').filter(e => e.date).map(e => ({ ...e, _src: 'events', _kind: 'evento', _hora: e.time || '', _titulo: e.title || 'Evento' }));
      const gc = (agenda.eventos || []).map(e => ({ id: 'g:' + e.id, date: e.data, _src: 'google', _kind: 'google', _hora: e.hora || '', _fim: e.horaFim || '', _titulo: e.titulo, local: e.local }));
      return [...ts, ...ev, ...gc];
    },
    compromissosDoDia(iso) {
      return T.itensCalendario().filter(i => i.date === iso && i._kind !== 'post').sort((a, b) => (a._hora || '99').localeCompare(b._hora || '99'));
    },
    novoId() { return 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
    kindInfo(k) {
      return ({ google: { label: 'Agenda Google', icon: 'fa-calendar-check' }, post: { label: 'Conteúdo', icon: 'fa-clapperboard' }, reuniao: { label: 'Reunião', icon: 'fa-handshake' }, follow: { label: 'Follow-up', icon: 'fa-phone' }, evento: { label: 'Evento', icon: 'fa-calendar-day' } })[k] || { label: 'Item', icon: 'fa-circle' };
    }
  };


  // ---------- funções do servidor (Supabase Edge Functions) ----------
  async function chamarFuncao(nome, body) {
    if (!window.App || !App.configured) throw new Error('LOCAL');
    const { data: { session } } = await App.supabase.auth.getSession();
    if (!session) throw new Error('Sua sessão expirou. Entre de novo.');
    const res = await fetch(PLASSO_CONFIG.SUPABASE_URL + '/functions/v1/' + nome, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: PLASSO_CONFIG.SUPABASE_ANON_KEY, 'x-user-token': session.access_token },
      body: JSON.stringify(body || {})
    });
    const out = await res.json().catch(() => ({}));
    if (res.status === 404 && !out.error) throw new Error('Função "' + nome + '" não publicada no Supabase.');
    if (!res.ok) throw new Error(out.error || out.message || ('Erro ' + res.status));
    return out;
  }

  // ---------- mídia do Google Drive ----------
  const DEMO_MIDIAS = [ // só no modo de teste local (pasta pública de exemplo)
    { id: '16olTbbGOLaJUwua2c_QZhGn1o5U6Fp0F', nome: 'lamina-01.png', tipo: 'imagem' },
    { id: '1w0sHfBZy_Pn2SQgZ7ffxloskECKUqv6_', nome: 'lamina-02.png', tipo: 'imagem' },
    { id: '1VzvwCtGGYaDnrU_thq1R-H3iMlB80NZz', nome: 'lamina-03.png', tipo: 'imagem' },
    { id: 'demo-video', nome: 'reels-final.mp4', tipo: 'video' }
  ];
  async function driveBuscar(url) {
    if (!url || !/drive\.google\.com|docs\.google\.com/.test(url)) throw new Error('Cole um link do Google Drive.');
    try {
      const out = await chamarFuncao('drive-midia', { url });
      return out.midias || [];
    } catch (e) {
      if (e.message === 'LOCAL') return DEMO_MIDIAS.map(m => ({ ...m }));
      throw e;
    }
  }
  const midiaImg = (m, w = 1600) => m.id === 'demo-video' ? 'https://lh3.googleusercontent.com/d/1Ig7DAzpcYx6C_xw4ua3zBSnfJWAtc0YB=w' + w : `https://lh3.googleusercontent.com/d/${m.id}=w${w}`;
  const midiaThumbAlt = (m, w = 1000) => `https://drive.google.com/thumbnail?id=${m.id}&sz=w${w}`;

  // carrossel: arraste para o lado (mesma ordem do Drive)
  function carrossel(midias, { ratio = '4/5', capa = false } = {}) {
    const ms = (midias || []).filter(m => m && m.id);
    if (!ms.length) return '';
    const slides = ms.map((m, i) => m.tipo === 'video'
      ? `<div class="car-slide" data-i="${i}"><button class="car-video" data-video="${esc(m.id)}" aria-label="Assistir ${esc(m.nome || 'vídeo')}">
           <img loading="lazy" src="${midiaThumbAlt(m)}" onerror="this.style.display='none'" alt=""><span class="car-play"><i class="fa-solid fa-play"></i></span></button></div>`
      : `<div class="car-slide" data-i="${i}"><img loading="${i < 2 ? 'eager' : 'lazy'}" src="${midiaImg(m)}" onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${midiaThumbAlt(m, 1600)}'}" alt="${esc(m.nome || '')}"></div>`).join('');
    return `<div class="carousel ${capa ? 'capa' : ''}" style="--ratio:${ratio}" data-carousel>
      <div class="car-track">${slides}</div>
      ${ms.length > 1 ? `<button class="car-nav prev" aria-label="Anterior"><i class="fa-solid fa-chevron-left"></i></button><button class="car-nav next" aria-label="Próximo"><i class="fa-solid fa-chevron-right"></i></button>
      <div class="car-count num">1/${ms.length}</div><div class="car-dots">${ms.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
      ${ms.some(m => m.tipo === 'video') && ms.length === 1 ? '' : ''}
    </div>`;
  }
  function ativarCarrosseis(root = document) {
    root.querySelectorAll('[data-carousel]:not([data-ok])').forEach(c => {
      c.dataset.ok = 1;
      const track = c.querySelector('.car-track');
      const n = track.children.length;
      const atual = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      const upd = () => {
        const i = atual();
        const cnt = c.querySelector('.car-count'); if (cnt) cnt.textContent = (i + 1) + '/' + n;
        c.querySelectorAll('.car-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
      };
      track.addEventListener('scroll', () => requestAnimationFrame(upd), { passive: true });
      const ir = d => track.scrollTo({ left: (atual() + d) * track.clientWidth, behavior: 'smooth' });
      const pv = c.querySelector('.prev'), nx = c.querySelector('.next');
      if (pv) pv.onclick = e => { e.stopPropagation(); ir(-1); };
      if (nx) nx.onclick = e => { e.stopPropagation(); ir(1); };
      c.querySelectorAll('[data-video]').forEach(b => b.onclick = e => {
        e.stopPropagation();
        const id = b.dataset.video;
        if (id === 'demo-video') { b.querySelector('.car-play').innerHTML = '<i class="fa-solid fa-circle-info"></i>'; return; }
        b.outerHTML = `<iframe src="https://drive.google.com/file/d/${id}/preview" allow="autoplay; fullscreen" allowfullscreen loading="lazy"></iframe>`;
      });
    });
  }
  function capaUrl(t) {
    const m = (t.midias || [])[0];
    if (!m) return '';
    return m.tipo === 'video' ? midiaThumbAlt(m, 800) : midiaImg(m, 800);
  }

  // ---------- agenda externa (Google Agenda / Notion Calendar via iCal) ----------
  const agenda = {
    eventos: [],
    carregada: false,
    async carregar(force) {
      const cfg = window.DB ? DB.getValue('config_agenda', null) : null;
      if (!cfg || !cfg.url) { agenda.eventos = []; agenda.carregada = true; return agenda.eventos; }
      const chave = 'plasso_agenda_cache';
      if (!force) {
        try { const c = JSON.parse(sessionStorage.getItem(chave) || 'null'); if (c && c.url === cfg.url && Date.now() - c.em < 10 * 60e3) { agenda.eventos = c.eventos; agenda.carregada = true; return agenda.eventos; } } catch (e) {}
      }
      try {
        const out = await chamarFuncao('agenda-ics', { url: cfg.url });
        agenda.eventos = out.eventos || [];
        try { sessionStorage.setItem(chave, JSON.stringify({ url: cfg.url, em: Date.now(), eventos: agenda.eventos })); } catch (e) {}
      } catch (e) {
        if (e.message !== 'LOCAL') console.warn('agenda', e);
        agenda.erro = e.message === 'LOCAL' ? '' : e.message;
      }
      agenda.carregada = true;
      return agenda.eventos;
    },
    configurar(onDone) {
      const cfg = DB.getValue('config_agenda', null) || {};
      const s = sheet({
        title: 'Conectar sua agenda',
        html: `<p class="small soft">Os eventos da sua agenda do <b>Google</b> aparecem no Calendário, na Home e no Modo Trabalho. O <b>Notion Calendar</b> usa as suas contas do Google, então os eventos dele vêm junto.</p>
          <ol class="small soft mt-3" style="padding-left:18px;line-height:1.7">
            <li>No computador, abra <b>calendar.google.com</b> → engrenagem → <b>Configurações</b>.</li>
            <li>À esquerda, clique na sua agenda (em "Configurações das minhas agendas").</li>
            <li>Desça até <b>"Endereço secreto no formato iCal"</b> e copie.</li>
            <li>Cole aqui embaixo. Quer mais de uma agenda? Cole um endereço por linha.</li>
          </ol>
          <label class="field mt-3"><span>Endereço(s) iCal</span><textarea class="textarea" id="ag-url" rows="3" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics">${esc((cfg.urls || [cfg.url]).filter(Boolean).join('\n'))}</textarea></label>
          <p class="tiny muted mt-2"><i class="fa-solid fa-lock"></i> O endereço é secreto: fica salvo só na sua conta. Não compartilhe com ninguém.</p>
          <p class="tiny muted">A leitura é só de consulta: os eventos que você criar aqui ficam no Plassô; os do Google continuam sendo editados no Google/Notion.</p>`,
        foot: `${cfg.url ? '<button class="btn btn-danger" id="ag-del">Desconectar</button>' : ''}<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-white" id="ag-ok">Salvar e testar</button>`
      });
      s.$('#ag-ok').onclick = async () => {
        const urls = s.$('#ag-url').value.split(/\s+/).map(x => x.trim()).filter(Boolean);
        if (!urls.length || !urls.every(u => /^(https|webcal):\/\//i.test(u))) { App.toast('Cole o endereço iCal (começa com https://).', 'warn'); return; }
        s.$('#ag-ok').disabled = true; s.$('#ag-ok').textContent = 'Testando…';
        try {
          let todos = [];
          for (const u of urls) { const out = await chamarFuncao('agenda-ics', { url: u }); todos = todos.concat(out.eventos || []); }
          DB.setValue('config_agenda', { url: urls[0], urls });
          agenda.eventos = todos; try { sessionStorage.removeItem('plasso_agenda_cache'); } catch (e) {}
          s.close(); App.toast(`Agenda conectada: ${todos.length} eventos encontrados.`, 'ok'); onDone && onDone();
        } catch (e) {
          s.$('#ag-ok').disabled = false; s.$('#ag-ok').textContent = 'Salvar e testar';
          App.toast(e.message === 'LOCAL' ? 'No modo de teste a agenda não é lida.' : 'Não funcionou: ' + e.message, 'err');
        }
      };
      const del = s.$('#ag-del'); if (del) del.onclick = () => { DB.setValue('config_agenda', null); agenda.eventos = []; try { sessionStorage.removeItem('plasso_agenda_cache'); } catch (e) {} s.close(); App.toast('Agenda desconectada.', 'ok'); onDone && onDone(); };
    }
  };
  // várias agendas: carrega todas
  const carregarUma = agenda.carregar;
  agenda.carregar = async function (force) {
    const cfg = window.DB ? DB.getValue('config_agenda', null) : null;
    if (!cfg || !(cfg.urls || [cfg.url]).filter(Boolean).length) { agenda.eventos = []; agenda.carregada = true; return []; }
    const urls = (cfg.urls || [cfg.url]).filter(Boolean);
    const chave = 'plasso_agenda_cache';
    if (!force) { try { const c = JSON.parse(sessionStorage.getItem(chave) || 'null'); if (c && c.k === urls.join('|') && Date.now() - c.em < 10 * 60e3) { agenda.eventos = c.eventos; agenda.carregada = true; return c.eventos; } } catch (e) {} }
    let todos = [];
    for (const u of urls) { try { const out = await chamarFuncao('agenda-ics', { url: u }); todos = todos.concat(out.eventos || []); } catch (e) { if (e.message === 'LOCAL') todos = todos.concat(DB.getValue('demo_agenda', []) || []); else agenda.erro = e.message; } }
    agenda.eventos = todos; agenda.carregada = true;
    try { sessionStorage.setItem(chave, JSON.stringify({ k: urls.join('|'), em: Date.now(), eventos: todos })); } catch (e) {}
    return todos;
  };

  // menu da conta (todas as páginas)
  function menu() {
    const s = sheet({
      title: 'Menu',
      html: `<div class="list">
        <a class="item" href="${keepParams('lancar.html')}"><div class="icon accent"><i class="fa-solid fa-plus"></i></div><div class="grow"><div class="title">Lançar gasto rápido</div><div class="sub">Abre o lançamento do financeiro</div></div></a>
        <a class="item" href="${keepParams('criacao.html')}"><div class="icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div><div class="grow"><div class="title">Agente de criação</div><div class="sub">Conteúdos com IA a partir do briefing</div></div></a>
        <button class="item item-btn" id="m-backup"><div class="icon"><i class="fa-solid fa-download"></i></div><div class="grow"><div class="title">Baixar backup</div><div class="sub">Arquivo com todos os seus dados</div></div></button>
        ${window.App && App.configured ? `<button class="item item-btn" id="m-senha"><div class="icon accent"><i class="fa-solid fa-key"></i></div><div class="grow"><div class="title">Criar / trocar senha</div><div class="sub">Defina a senha de acesso desta conta</div></div></button>` : ''}
        ${window.App && App.configured ? `<button class="item item-btn" id="m-sair"><div class="icon"><i class="fa-solid fa-right-from-bracket"></i></div><div class="grow"><div class="title">Sair</div><div class="sub">${esc((App.user && App.user.email) || '')}</div></div></button>` : ''}
      </div>`
    });
    s.$('#m-backup').onclick = () => { App.exportBackup(); s.close(); };
    const sair = s.$('#m-sair'); if (sair) sair.onclick = () => App.logout();
    const senha = s.$('#m-senha'); if (senha) senha.onclick = () => { s.close(); setTimeout(trocarSenha, 220); };
  }

  // criar / trocar a senha estando logado (não precisa de e-mail)
  function trocarSenha() {
    const s = sheet({
      title: 'Criar / trocar senha',
      html: `<p class="small soft">Conta: <b>${esc((App.user && App.user.email) || '')}</b></p>
        <form id="f-ns" class="stack mt-3" autocomplete="on">
          <input type="email" name="username" autocomplete="username" value="${esc((App.user && App.user.email) || '')}" hidden>
          <label class="field"><span>Nova senha (mínimo 8 caracteres)</span><input class="input" type="password" id="ns1" autocomplete="new-password" minlength="8" required></label>
          <label class="field"><span>Repita a nova senha</span><input class="input" type="password" id="ns2" autocomplete="new-password" minlength="8" required></label>
          <p class="tiny muted">Quando o navegador perguntar "Salvar senha?", toque em Salvar.</p>
        </form>`,
      foot: '<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-white" id="ns-ok">Salvar senha</button>'
    });
    s.$('#ns-ok').onclick = async () => {
      const a = s.$('#ns1').value, b = s.$('#ns2').value;
      if (a.length < 8) { App.toast('A senha precisa ter pelo menos 8 caracteres.', 'warn'); return; }
      if (a !== b) { App.toast('As senhas não conferem.', 'warn'); return; }
      s.$('#ns-ok').disabled = true;
      const { error } = await App.supabase.auth.updateUser({ password: a });
      s.$('#ns-ok').disabled = false;
      if (error) { App.toast(/different/i.test(error.message) ? 'Essa já é a sua senha atual.' : 'Não foi possível salvar: ' + error.message, 'err'); return; }
      s.close(); App.toast('Senha salva! Use seu e-mail e essa senha para entrar.', 'ok');
    };
  }

  window.UI = { mount, sheet, menu, trocarSenha, chamarFuncao, driveBuscar, carrossel, ativarCarrosseis, capaUrl, midiaImg, agenda, formData, esc, keepParams, TABS, hoje, agoraHM, brl, brlParts, dataBR, diaMes, dias, addDias, mesNome, diaSemana, quando, saudacao, iniciais, STATUS, FORMATOS, T };
})();
