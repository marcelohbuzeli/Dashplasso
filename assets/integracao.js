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
    const produtos = [...new Set(DB.list('clients').map(c => c.produto).filter(Boolean))];
    const hoje = todayISO();
    const L = lead || {};
    const sh = UI.sheet({
      title: lead ? 'Fechou contrato 🎉' : 'Novo cliente',
      wide: true,
      html: `
        <p class="small soft" style="margin-top:-4px">Ao confirmar, o cliente é criado na <b>Empresa</b> e os recebimentos entram no <b>Financeiro</b> como "a conferir", um por mês de contrato.</p>
        <datalist id="conv-produtos">${produtos.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
        <div class="form-grid mt-3">
          <label class="field full"><span>Nome do cliente / empresa</span><input class="input" name="name" required value="${esc(L.name || '')}"></label>
          <label class="field full"><span>Produto</span><input class="input" name="produto" list="conv-produtos" placeholder="Ex.: Gestão de Redes — Pro" autocomplete="off"></label>
          <label class="field"><span>Valor mensal (R$)</span><input class="input" type="number" step="0.01" min="0" inputmode="decimal" name="fee" value="${esc(L.valor || '')}"></label>
          <label class="field"><span>Conteúdos por mês</span><input class="input" type="number" min="0" name="quantidadeMes" placeholder="Ex.: 12"></label>
          <label class="field"><span>Tempo de contrato (meses)</span><input class="input" type="number" min="1" name="contratoMeses" value="6"></label>
          <label class="field"><span>Data de entrada</span><input class="input" type="date" name="inicio" value="${hoje}"></label>
          <label class="field"><span>1º vencimento</span><input class="input" type="date" name="primeiroVencimento" value="${hoje}"></label>
          <label class="field"><span>WhatsApp</span><input class="input" inputmode="tel" name="whatsapp" value="${esc(L.telefone || '')}" placeholder="(11) 99999-9999"></label>
          <label class="field"><span>Instagram</span><input class="input" name="instagram" value="${esc(L.insta || '')}"></label>
          <label class="field"><span>E-mail</span><input class="input" type="email" name="email" value="${esc(L.email || '')}"></label>
          <label class="field full"><span>CPF / CNPJ</span><input class="input" name="documento"></label>
          <label class="field full"><span>Objetivo principal</span><input class="input" name="objetivo" placeholder="Ex.: gerar agendamentos"></label>
          <label class="field full"><span>Briefing (o agente de criação usa este texto)</span><textarea class="textarea" name="briefing" rows="4" placeholder="Público, tom de voz, diferenciais, temas, o que evitar…">${esc(L.notas || '')}</textarea></label>
        </div>
        <div class="card card-tight mt-3 small" data-prev></div>`,
      foot: '<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-white" data-ok>Confirmar cliente</button>'
    });
    const prev = () => {
      const f = UI.formData(sh.el);
      const v = Number(f.fee) || 0, m = Number(f.contratoMeses) || 0, d = f.primeiroVencimento;
      sh.$('[data-prev]').innerHTML = d && m && v
        ? `<i class="fa-solid fa-wallet"></i> Financeiro: <b>${m}× ${UI.brl(v)}</b> de ${UI.dataBR(d)} até ${UI.dataBR(addMonths(d, m - 1))} · total ${UI.brl(v * m)}`
        : '<span class="muted">Preencha valor, tempo de contrato e 1º vencimento para gerar os recebimentos.</span>';
    };
    sh.el.addEventListener('input', prev); prev();
    sh.$('[data-ok]').onclick = () => {
      const dados = UI.formData(sh.el);
      if (!dados.name.trim()) { App.toast('Informe o nome do cliente.', 'warn'); return; }
      if (!(Number(dados.fee) > 0) || !dados.primeiroVencimento || !(Number(dados.contratoMeses) > 0)) { App.toast('Preencha valor, 1º vencimento e tempo de contrato.', 'warn'); return; }
      dados.name = dados.name.trim();
      const r = converterLead(lead, dados);
      sh.close();
      App.toast(`${r.client.name} virou cliente · ${r.recebimentos.length} recebimentos no Financeiro`, 'ok');
      onDone && onDone(r);
    };
  }

  function whatsappLink(client, texto) {
    const fone = String(client.whatsapp || '').replace(/\D/g, '');
    const numero = fone && fone.length <= 11 ? '55' + fone : fone;
    return 'https://wa.me/' + numero + '?text=' + encodeURIComponent(texto);
  }

  window.Integracao = { converterLead, gerarRecebimentos, encerrarCliente, renovarContrato, abrirConversao, portalUrl, ensurePortalToken, whatsappLink, addMonths };
})();
