/* =====================================================================
   Financeiro — regras de negócio (usado por finance.html, lancar.html, index.html)
   Coleção: fin_lancamentos
   { id, tipo:'entrada'|'saida', descricao, empresa, valor, data:'AAAA-MM-DD',
     categoria, conta:'Empresa'|'Pessoal', forma, status:'pago'|'a_conferir'|'cancelado',
     obs, grupoId, parcela, totalParcelas, recorrente, clienteId, origem }
   ===================================================================== */
(function () {
  'use strict';
  const COL = 'fin_lancamentos';
  const CATS_PADRAO = {
    saida: ['Alimentação', 'Mercado', 'Transporte', 'Combustível', 'Moradia', 'Contas da casa', 'Saúde', 'Educação', 'Lazer', 'Assinaturas', 'Ferramentas / Software', 'Equipamentos', 'Marketing / Anúncios', 'Impostos', 'Taxas bancárias', 'Vestuário', 'Outros'],
    entrada: ['Clientes', 'Serviço avulso', 'Reembolso', 'Outros']
  };

  const brl = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtData = iso => iso ? iso.split('-').reverse().join('/') : '';
  const round2 = v => Math.round(v * 100) / 100;

  function addMonthsKey(key, n) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  }
  function addMonths(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(d, last));
    return t.toISOString().slice(0, 10);
  }

  const todos = () => DB.list(COL);
  const ativos = () => todos().filter(l => l.status !== 'cancelado');

  function resumoMes(list, key) {
    const r = { entPago: 0, entPrev: 0, saiPago: 0, saiPrev: 0 };
    list.forEach(l => {
      if (!l.data || l.data.slice(0, 7) !== key || l.status === 'cancelado') return;
      const v = Number(l.valor) || 0;
      const pago = l.status === 'pago';
      if (l.tipo === 'entrada') pago ? r.entPago += v : r.entPrev += v;
      else pago ? r.saiPago += v : r.saiPrev += v;
    });
    r.entTotal = r.entPago + r.entPrev;
    r.saiTotal = r.saiPago + r.saiPrev;
    r.saldoPrev = r.entTotal - r.saiTotal;
    return r;
  }

  function categorias(tipo) {
    const usadas = todos().filter(l => !tipo || l.tipo === tipo).map(l => l.categoria).filter(Boolean);
    const padrao = tipo ? CATS_PADRAO[tipo] : [...CATS_PADRAO.saida, ...CATS_PADRAO.entrada];
    return [...new Set([...usadas, ...padrao])];
  }

  // categoria usada da última vez para a mesma empresa
  function sugerirCategoria(empresa) {
    const e = String(empresa || '').trim().toLowerCase();
    if (!e) return '';
    const hit = todos().filter(l => l.categoria && (l.empresa || l.descricao || '').toLowerCase() === e).sort((a, b) => (b.criadoEm || b.data).localeCompare(a.criadoEm || a.data))[0];
    return hit ? hit.categoria : '';
  }
  function categoriasRecentes(tipo = 'saida', n = 8) {
    const seen = []; todos().filter(l => l.tipo === tipo && l.categoria).sort((a, b) => (b.criadoEm || b.data).localeCompare(a.criadoEm || a.data)).forEach(l => { if (!seen.includes(l.categoria)) seen.push(l.categoria); });
    return [...new Set([...seen, ...CATS_PADRAO[tipo]])].slice(0, n);
  }

  // cria lançamento único, parcelado ou recorrente. Retorna quantos foram criados.
  function criar(base, modo = 'unica', opts = {}) {
    const agora = new Date().toISOString();
    if (modo === 'unica') {
      DB.put(COL, { ...base, id: App.uid('fl_'), criadoEm: agora });
      return 1;
    }
    const grupo = App.uid('g_');
    const n = modo === 'parcelada' ? Math.max(2, Math.min(72, opts.parcelas || 2)) : Math.max(2, Math.min(60, opts.meses || 12));
    let valores;
    if (modo === 'parcelada' && opts.valorModo !== 'parcela') {
      // divide o total; a diferença de centavos vai na 1ª parcela
      const p = Math.floor(base.valor / n * 100) / 100;
      valores = Array(n).fill(p);
      valores[0] = round2(base.valor - p * (n - 1));
    } else valores = Array(n).fill(round2(base.valor));
    const itens = valores.map((v, i) => ({
      ...base,
      id: grupo + '_' + (i + 1),
      valor: v,
      data: addMonths(base.data, i),
      // a 1ª parcela mantém o status escolhido; as futuras ficam "a conferir"
      status: i === 0 ? base.status : 'a_conferir',
      grupoId: grupo, parcela: i + 1, totalParcelas: n,
      recorrente: modo === 'recorrente',
      criadoEm: agora
    }));
    DB.putMany(COL, itens);
    return n;
  }

  function editar(id, campos, aplicar = 'este') {
    const l = DB.get(COL, id); if (!l) return;
    const alvo = aplicar === 'proximos' && l.grupoId
      ? todos().filter(x => x.grupoId === l.grupoId && x.parcela >= l.parcela)
      : [l];
    alvo.forEach(x => {
      const isSelf = x.id === l.id;
      Object.assign(x, {
        tipo: campos.tipo, descricao: campos.descricao, empresa: campos.empresa, valor: campos.valor,
        categoria: campos.categoria, conta: campos.conta, forma: campos.forma, obs: campos.obs
      });
      if (isSelf) { x.data = campos.data; x.status = campos.status; }
    });
    DB.putMany(COL, alvo);
  }

  function setStatus(id, status) {
    const l = DB.get(COL, id); if (!l) return;
    l.status = status;
    if (status === 'pago') l.confirmadoEm = new Date().toISOString();
    DB.put(COL, l);
  }

  function remover(id, modo = 'este') {
    const l = DB.get(COL, id); if (!l) return;
    if (modo === 'todos' && l.grupoId) DB.removeWhere(COL, x => x.grupoId === l.grupoId);
    else if (modo === 'proximos' && l.grupoId) DB.removeWhere(COL, x => x.grupoId === l.grupoId && x.parcela >= l.parcela);
    else DB.remove(COL, id);
  }

  // converte as listas antigas (plasso_entries / plasso_expenses) uma única vez
  function migrarAntigos() {
    if (DB.getValue('fin_migrado', false)) return;
    const ent = DB.list('entries'), sai = DB.list('expenses');
    const itens = [];
    ent.forEach(e => itens.push({ id: 'old_' + e.id, tipo: 'entrada', descricao: e.name, empresa: e.name, valor: Number(e.value) || 0, data: e.date, categoria: 'Clientes', conta: 'Empresa', status: 'pago', origem: 'antigo' }));
    sai.forEach(e => itens.push({ id: 'old_' + e.id, tipo: 'saida', descricao: e.name, empresa: e.name, valor: Number(e.value) || 0, data: e.date, categoria: '', conta: 'Empresa', status: 'pago', origem: 'antigo' }));
    if (itens.length) DB.putMany(COL, itens.filter(i => i.data));
    DB.setValue('fin_migrado', true);
  }

  window.Financas = { brl, fmtData, addMonths, addMonthsKey, todos, ativos, resumoMes, categorias, categoriasRecentes, sugerirCategoria, criar, editar, setStatus, remover, migrarAntigos };
})();
