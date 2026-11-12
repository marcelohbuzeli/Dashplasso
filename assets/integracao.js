/* =====================================================================
   Integração entre sistemas
   CRM  --(lead vira cliente)-->  Gestão (clients)  +  Financeiro (fin_lancamentos)
   Gestão --(cliente encerrado)--> Financeiro (cancela recebimentos futuros)
   Depende de assets/core.js (App, DB).
   ===================================================================== */
(function () {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayISO = () => new Date().toISOString().slice(0, 10);

  // soma meses mantendo o dia (31/01 + 1 mês -> 28 ou 29/02)
  function addMonths(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, last));
    return target.toISOString().slice(0, 10);
  }

  function portalUrl(client) {
    const base = location.href.replace(/[^/]*$/, '');
    return base + 'portal.html?t=' + client.portalToken;
  }

  function ensurePortalToken(client) {
    if (!client.portalToken) { client.portalToken = App.randomToken(32); DB.put('clients', client); }
    return client.portalToken;
  }

  // cria os recebimentos mensais do contrato no Financeiro
  function gerarRecebimentos(client) {
    const meses = Math.max(1, parseInt(client.contratoMeses || 1, 10));
    const grupo = 'contrato_' + client.id;
    const itens = [];
    for (let i = 0; i < meses; i++) {
      itens.push({
        id: grupo + '_' + (i + 1),
        tipo: 'entrada',
        descricao: `${client.produto || 'Contrato'} — ${client.name}`,
        empresa: client.name,
        valor: Number(client.fee) || 0,
        data: addMonths(client.primeiroVencimento, i),
        categoria: 'Clientes',
        status: 'a_conferir',
        clienteId: client.id,
        origem: 'crm',
        grupoId: grupo,
        parcela: i + 1,
        totalParcelas: meses,
        criadoEm: new Date().toISOString()
      });
    }
    DB.putMany('fin_lancamentos', itens);
    return itens;
  }

  function converterLead(lead, dados) {
    const client = {
      id: 'c_' + Date.now(),
      name: dados.name,
      status: 'ativo',
      produto: dados.produto,
      quantidadeMes: Number(dados.quantidadeMes) || 0,
      fee: Number(dados.fee) || 0,
      inicio: dados.inicio,
      primeiroVencimento: dados.primeiroVencimento,
      dueDate: dados.primeiroVencimento,
      contratoMeses: Number(dados.contratoMeses) || 1,
      whatsapp: dados.whatsapp || '',
      instagram: dados.instagram || (lead && lead.insta) || '',
      email: dados.email || '',
      documento: dados.documento || '',
      objetivo: dados.objetivo || '',
      briefing: dados.briefing || '',
      isOverdue: false,
      origemLeadId: lead ? lead.id : null,
      historicoLead: lead ? (lead.historyArray || []) : [],
      portalToken: App.randomToken(32),
      criadoEm: new Date().toISOString()
    };
    DB.put('clients', client);
    const recebimentos = gerarRecebimentos(client);
    return { client, recebimentos };
  }

  // cancela recebimentos ainda não conferidos a partir de uma data
  function encerrarCliente(clientId, aPartirDe = todayISO()) {
    const c = DB.get('clients', clientId);
    if (c) { c.status = 'encerrado'; c.encerradoEm = aPartirDe; DB.put('clients', c); }
    const futuros = DB.list('fin_lancamentos').filter(l => l.clienteId === clientId && l.status === 'a_conferir' && l.data >= aPartirDe);
    futuros.forEach(l => { l.status = 'cancelado'; });
    if (futuros.length) DB.putMany('fin_lancamentos', futuros);
    return futuros.length;
  }

  // renova por mais N meses a partir do último recebimento
  function renovarContrato(clientId, meses) {
    const c = DB.get('clients', clientId); if (!c) return 0;
    const existentes = DB.list('fin_lancamentos').filter(l => l.grupoId === 'contrato_' + c.id);
    const ultimo = existentes.reduce((a, l) => l.data > a ? l.data : a, c.primeiroVencimento);
    const n = existentes.length;
    const novos = [];
    for (let i = 1; i <= meses; i++) {
      novos.push({
        id: 'contrato_' + c.id + '_' + (n + i), tipo: 'entrada', descricao: `${c.produto || 'Contrato'} — ${c.name}`, empresa: c.name,
        valor: Number(c.fee) || 0, data: addMonths(ultimo, i), categoria: 'Clientes', status: 'a_conferir',
        clienteId: c.id, origem: 'renovacao', grupoId: 'contrato_' + c.id, parcela: n + i, totalParcelas: n + meses, criadoEm: new Date().toISOString()
      });
    }
    c.contratoMeses = (Number(c.contratoMeses) || 0) + meses; c.status = 'ativo';
    DB.put('clients', c);
    DB.putMany('fin_lancamentos', novos);
    return novos.length;
  }

  // ---------- modal de conversão ----------
  function abrirConversao(lead, onDone) {
    document.getElementById('conv-modal')?.remove();
    const produtos = [...new Set(DB.list('clients').map(c => c.produto).filter(Boolean))];
    const hoje = todayISO();
    const wrap = document.createElement('div');
    wrap.id = 'conv-modal';
    wrap.className = 'fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';
    const inp = 'mt-1 w-full bg-dark-950 border border-dark-800 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-blue-500';
    wrap.innerHTML = `
      <form class="bg-dark-900 border border-dark-800 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6 space-y-5 shadow-2xl">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-white font-bold text-lg flex items-center gap-2"><i class="fa-solid fa-handshake text-emerald-400"></i> Novo cliente</h3>
            <p class="text-xs text-slate-400 mt-1">Ao salvar: o cliente é criado na Gestão e os recebimentos entram no Financeiro como <b>a conferir</b>.</p>
          </div>
          <button type="button" data-x class="text-slate-400 hover:text-white p-2"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <datalist id="conv-produtos">${produtos.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-400">
          <label class="md:col-span-2">Nome do cliente / empresa<input name="name" required value="${esc(lead ? lead.name : '')}" class="${inp}"></label>
          <label>Produto<input name="produto" list="conv-produtos" required placeholder="Ex.: Gestão de Redes — Plano Pro" class="${inp}"></label>
          <label>Conteúdos por mês<input name="quantidadeMes" type="number" min="0" placeholder="Ex.: 12" class="${inp}"></label>
          <label>Valor mensal (R$)<input name="fee" type="number" step="0.01" min="0" required class="${inp}"></label>
          <label>Tempo de contrato (meses)<input name="contratoMeses" type="number" min="1" value="6" required class="${inp}"></label>
          <label>Data de entrada<input name="inicio" type="date" value="${hoje}" required class="${inp}"></label>
          <label>1º vencimento<input name="primeiroVencimento" type="date" value="${hoje}" required class="${inp}"></label>
          <label>WhatsApp<input name="whatsapp" placeholder="(11) 99999-9999" class="${inp}"></label>
          <label>Instagram<input name="instagram" value="${esc(lead ? lead.insta || '' : '')}" class="${inp}"></label>
          <label>E-mail<input name="email" type="email" class="${inp}"></label>
          <label>CPF / CNPJ<input name="documento" class="${inp}"></label>
          <label class="md:col-span-2">Objetivo principal<input name="objetivo" placeholder="Ex.: gerar agendamentos para harmonização facial" class="${inp}"></label>
          <label class="md:col-span-2">Briefing (o agente de criação usa este texto)<textarea name="briefing" rows="5" placeholder="Público, tom de voz, diferenciais, temas, o que evitar, referências…" class="${inp}"></textarea></label>
        </div>
        <div id="conv-preview" class="text-xs font-mono text-slate-400 bg-dark-950 border border-dark-800 rounded-xl p-3"></div>
        <div class="flex justify-end gap-3">
          <button type="button" data-x class="px-4 py-2 rounded-xl text-slate-300 hover:bg-dark-800 text-sm">Cancelar</button>
          <button class="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-xl text-sm font-semibold">Confirmar cliente</button>
        </div>
      </form>`;
    document.body.appendChild(wrap);
    const f = wrap.querySelector('form');
    const prev = () => {
      const v = Number(f.fee.value) || 0, m = Number(f.contratoMeses.value) || 0, d = f.primeiroVencimento.value;
      f.querySelector('#conv-preview') && (wrap.querySelector('#conv-preview').innerHTML = d && m
        ? `Financeiro: ${m}× R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} de ${d.split('-').reverse().join('/')} até ${addMonths(d, m - 1).split('-').reverse().join('/')} · total R$ ${(v * m).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        : 'Preencha valor, contrato e vencimento.');
    };
    f.addEventListener('input', prev); prev();
    wrap.querySelectorAll('[data-x]').forEach(b => b.onclick = () => wrap.remove());
    f.addEventListener('submit', e => {
      e.preventDefault();
      const dados = Object.fromEntries(new FormData(f).entries());
      const r = converterLead(lead, dados);
      wrap.remove();
      App.toast(`${r.client.name} virou cliente · ${r.recebimentos.length} recebimentos lançados no Financeiro`, 'ok');
      onDone && onDone(r);
    });
  }

  function whatsappLink(client, texto) {
    const fone = String(client.whatsapp || '').replace(/\D/g, '');
    const numero = fone && fone.length <= 11 ? '55' + fone : fone;
    return 'https://wa.me/' + numero + '?text=' + encodeURIComponent(texto);
  }

  window.Integracao = { converterLead, gerarRecebimentos, encerrarCliente, renovarContrato, abrirConversao, portalUrl, ensurePortalToken, whatsappLink, addMonths };
})();
