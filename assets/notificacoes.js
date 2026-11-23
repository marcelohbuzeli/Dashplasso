/* =====================================================================
   Plassô — notificações (sininho + push no celular)
   Carregado pelo core.js nas páginas logadas. Avisa quando um cliente,
   pelo portal, aprova um conteúdo ou pede ajuste (tabela notificacoes,
   preenchida pela função portal_update do banco).
   No celular: o site precisa estar instalado (iPhone: Safari > Compartilhar >
   Adicionar à Tela de Início) e as notificações ativadas no sininho.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.App || !App.configured || App.mode !== 'app' || !App.supabase || !App.user) return;
  const sb = App.supabase;
  const esc = App.esc;
  const cfg = window.PLASSO_CONFIG || {};
  const FN = cfg.SUPABASE_URL + '/functions/v1/notificar';

  // ---------- app instalável + service worker ----------
  if (!document.querySelector('link[rel="manifest"]')) {
    const l = document.createElement('link'); l.rel = 'manifest'; l.href = 'manifest.webmanifest'; document.head.appendChild(l);
  }
  const temPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const regPronto = 'serviceWorker' in navigator ? navigator.serviceWorker.register('sw.js').catch(() => null) : Promise.resolve(null);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  // ---------- sininho ----------
  let lista = [];
  const naoLidas = () => lista.filter(n => !n.lida).length;
  const btn = document.createElement('button');
  btn.className = 'chip-btn';
  btn.id = 'sino';
  btn.setAttribute('aria-label', 'Notificações');
  btn.style.position = 'relative';
  btn.onclick = abrir;
  function pintar() {
    const n = naoLidas();
    btn.innerHTML = `<i class="fa-${n ? 'solid' : 'regular'} fa-bell"></i>` +
      (n ? `<span style="position:absolute;top:-3px;right:-3px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#ff5a6e;color:#fff;font:700 10px/17px var(--font,system-ui);text-align:center">${n > 9 ? '9+' : n}</span>` : '');
  }
  function encaixar() {
    const row = document.querySelector('header.top .row');
    if (!row || document.getElementById('sino')) return;
    const menuBtn = [...row.querySelectorAll('button')].find(b => /UI\.menu/.test(b.getAttribute('onclick') || ''));
    row.insertBefore(btn, menuBtn || null);
    pintar();
  }

  async function carregar() {
    const { data } = await sb.from('notificacoes').select('*').order('criado_em', { ascending: false }).limit(40);
    lista = data || [];
    pintar();
  }

  const quando = iso => {
    const d = new Date(iso), min = Math.round((Date.now() - d) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    if (min < 1440) return `há ${Math.round(min / 60)} h`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + ' · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  async function estadoPush() {
    if (!temPush) return isIOS && !instalado ? 'instalar' : 'sem-suporte';
    if (Notification.permission === 'denied') return 'bloqueado';
    const reg = await regPronto;
    const sub = reg && await reg.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'ativo' : 'inativo';
  }

  async function blocoPush() {
    const st = await estadoPush();
    const card = (icone, txt, botao = '') => `<div class="card card-tight mb-3 small" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><i class="fa-solid ${icone} accent-text"></i><div style="flex:1;min-width:180px">${txt}</div>${botao}</div>`;
    if (st === 'ativo') return card('fa-mobile-screen', 'Notificações <b>ativadas</b> neste aparelho.', '<button class="btn btn-ghost btn-sm" id="n-teste">Enviar teste</button>');
    if (st === 'inativo') return card('fa-mobile-screen', 'Receba um aviso no celular quando um cliente aprovar ou pedir ajuste.', '<button class="btn btn-white btn-sm" id="n-ativar"><i class="fa-solid fa-bell"></i> Ativar neste aparelho</button>');
    if (st === 'instalar') return card('fa-mobile-screen', 'Para receber avisos no iPhone: no <b>Safari</b>, toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>. Depois abra o Dashplasso pelo ícone e ative aqui no sininho.');
    if (st === 'bloqueado') return card('fa-ban', 'As notificações estão bloqueadas para este site. Libere nos ajustes do navegador (ou do iPhone: Ajustes → Notificações → Dashplasso) e volte aqui.');
    return card('fa-circle-info', 'Este navegador não recebe notificações. No celular, use o Dashplasso instalado na Tela de Início.');
  }

  async function ativar() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { App.toast('Permissão negada. Libere as notificações nos ajustes.', 'err'); return false; }
    const reg = await regPronto;
    if (!reg) { App.toast('Não consegui preparar o aparelho. Recarregue a página.', 'err'); return false; }
    const r = await fetch(FN, { headers: { apikey: cfg.SUPABASE_ANON_KEY } });
    const { chave } = await r.json();
    const pad = '='.repeat((4 - chave.length % 4) % 4);
    const raw = atob((chave + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
    const j = sub.toJSON();
    const aparelho = isIOS ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'Computador';
    const { error } = await sb.from('push_inscricoes').upsert({ endpoint: j.endpoint, owner: App.user.id, p256dh: j.keys.p256dh, auth: j.keys.auth, aparelho }, { onConflict: 'endpoint' });
    if (error) { App.toast('Erro ao salvar o aparelho: ' + error.message, 'err'); return false; }
    App.toast('Notificações ativadas neste aparelho.', 'ok');
    teste();
    return true;
  }

  async function teste() {
    const { data, error } = await sb.functions.invoke('notificar', { body: { teste: true } });
    if (error || !data || !data.enviados) App.toast('Não consegui enviar o teste agora.', 'err');
  }

  async function abrir() {
    await carregar();
    const s = UI.sheet({ title: 'Notificações', html: '<div id="n-push"></div><div id="n-lista"></div>' });
    s.$('#n-push').innerHTML = await blocoPush();
    const a = s.$('#n-ativar'); if (a) a.onclick = async () => { a.disabled = true; try { if (await ativar()) s.$('#n-push').innerHTML = await blocoPush(); } catch (e) { App.toast('Erro: ' + e.message, 'err'); a.disabled = false; } };
    const t = s.$('#n-teste'); if (t) t.onclick = () => { teste(); App.toast('Teste enviado.', 'ok'); };
    s.$('#n-lista').innerHTML = lista.length ? `<div class="list">${lista.map(n => `
      <a class="item" href="aprovacao.html?cliente=${encodeURIComponent(n.cliente || '')}" style="${n.lida ? 'opacity:.6' : ''}">
        <div class="icon ${n.tipo === 'aprovado' ? 'accent' : ''}"><i class="fa-solid ${n.tipo === 'aprovado' ? 'fa-check' : 'fa-pen'}"></i></div>
        <div class="grow" style="min-width:0">
          <div class="title">${esc(n.cliente || '')} ${n.tipo === 'aprovado' ? 'aprovou' : 'pediu ajuste'}</div>
          <div class="sub truncate">${esc(n.titulo || '')}</div>
          ${n.comentario ? `<div class="tiny soft mt-1">“${esc(n.comentario)}”</div>` : ''}
        </div>
        <div class="tiny muted" style="white-space:nowrap">${quando(n.criado_em)}</div>
      </a>`).join('')}</div>` : '<div class="card empty"><i class="fa-regular fa-bell"></i>Nenhuma notificação ainda. Quando um cliente aprovar ou pedir ajuste pelo link, aparece aqui.</div>';
    // abriu = leu
    const ids = lista.filter(n => !n.lida).map(n => n.id);
    if (ids.length) {
      await sb.from('notificacoes').update({ lida: true }).in('id', ids);
      lista.forEach(n => { n.lida = true; });
      pintar();
    }
  }

  // ---------- tempo real: chegou notificação com a página aberta ----------
  sb.channel('notificacoes-' + App.user.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificacoes', filter: 'owner=eq.' + App.user.id }, p => {
      const n = p.new;
      lista.unshift(n); pintar();
      App.toast(`${n.cliente} ${n.tipo === 'aprovado' ? 'aprovou' : 'pediu ajuste em'}: ${n.titulo || 'conteúdo'}`, n.tipo === 'aprovado' ? 'ok' : 'err');
    })
    .subscribe();

  encaixar();
  carregar();
  window.Notificacoes = { abrir, ativar, teste };
})();
