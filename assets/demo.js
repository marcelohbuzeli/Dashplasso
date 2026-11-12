/* Dados de exemplo — SÓ para testes locais (localhost?local=1&demo=1). Nunca carregado em produção. */
window.PLASSO_DEMO = function () {
  const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.toLocaleDateString('sv-SE'); };
  const m = (n, day) => { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() + n); x.setDate(day); return x.toLocaleDateString('sv-SE'); };
  const tok = () => App.randomToken(32);

  const clients = [
    { id: 'c_bella', name: 'Clínica Bella', status: 'ativo', produto: 'Gestão de Redes — Pro', quantidadeMes: 12, fee: 1800, inicio: m(-2, 5), primeiroVencimento: m(-2, 10), dueDate: m(-2, 10), contratoMeses: 6, whatsapp: '11999990000', instagram: '@clinicabella', objetivo: 'Gerar agendamentos de harmonização facial', briefing: 'Clínica de estética em SP. Público feminino 28–50. Tom acolhedor e técnico. Evitar promessas de resultado.', portalToken: 'demoBellaToken000000000000000001', criadoEm: new Date().toISOString() },
    { id: 'c_lumi', name: 'Studio Lumi', status: 'ativo', produto: 'Social Media — Essencial', quantidadeMes: 8, fee: 1200, inicio: m(-1, 1), primeiroVencimento: m(-1, 15), dueDate: m(-1, 15), contratoMeses: 12, whatsapp: '11988887777', instagram: '@studiolumi', objetivo: 'Autoridade em fotografia de casamento', briefing: 'Fotógrafa de casamentos. Tom emocional.', portalToken: tok() },
    { id: 'c_sabor', name: 'Restaurante Sabor', fee: 950, dueDate: m(0, 20), isOverdue: false }
  ];
  const tasks = [
    { id: 't1', client: 'Clínica Bella', headline: '3 sinais de que sua pele precisa de cuidado', type: 'Reels', date: d(1), status: 'afazer', roteiro: 'Gancho: se você acorda assim…', legenda: 'Sua pele fala com você.' },
    { id: 't2', client: 'Clínica Bella', headline: 'Mitos sobre botox', type: 'Carrossel', date: d(3), status: 'pronto', manuallyMovedToPronto: true },
    { id: 't3', client: 'Studio Lumi', headline: 'Bastidores de um casamento na praia', type: 'Reels', date: d(5), status: 'afazer' },
    { id: 't4', client: 'Studio Lumi', headline: 'Checklist da noiva', type: 'Carrossel', date: d(-1), status: 'urgent', isRejected: true, notes: 'Reprovado pelo cliente: trocar a capa' },
    { id: 't5', client: 'Restaurante Sabor', headline: 'Prato da semana', type: 'Foto Única', date: d(8), status: 'afazer' },
    { id: 't6', client: 'Clínica Bella', headline: 'Depoimento da Dra. Carla', type: 'Reels', date: d(-4), status: 'aprovadas' },
    { id: 't7', client: 'Studio Lumi', headline: 'Como escolher o fotógrafo', type: 'Story', date: d(12), status: 'afazer' },
    { id: 't8', client: 'Padaria Grão', headline: '[15h] Reunião Padaria Grão', type: 'Reels', date: d(0), status: 'afazer', notes: 'crm_meeting', kind: 'reuniao', time: '15:00', caption: 'Reunião agendada às 15:00' },
    { id: 't9', client: 'Academia Força', headline: 'Follow Up: Follow (Academia Força)', type: 'Story', date: d(0), status: 'afazer', notes: 'crm_follow', kind: 'follow', time: '09:00' }
  ];
  const events = [{ id: 'ev1', date: d(2), title: 'Gravação Clínica Bella', time: '10:00' }];
  const crm = [
    { id: 'l1', name: 'Padaria Grão', insta: '@padariagrao', col: 'reuniao', valor: 1500, telefone: '11977776666', historyArray: ['Lead criado', 'Reunião marcada'] },
    { id: 'l2', name: 'Academia Força', insta: '@academiaforca', col: 'follow', valor: 2200, historyArray: ['Lead criado'] },
    { id: 'l3', name: 'Pet Shop Amigo', insta: '@petamigo', col: 'novolead', valor: 900, historyArray: ['Lead criado'] },
    { id: 'l4', name: 'Ótica Visão', insta: '@oticavisao', col: 'relacionamento', valor: 1300, historyArray: ['Lead criado'] },
    { id: 'l5', name: 'Doceria Mel', insta: '@doceriamel', col: 'aguardando', valor: 1100, historyArray: ['Proposta enviada'] },
    { id: 'l6', name: 'Barbearia Corte', insta: '@barbeariacorte', col: 'novolead', historyArray: ['Lead criado'] }
  ];
  const fin = [];
  const add = o => fin.push({ conta: 'Empresa', status: 'pago', ...o, id: 'f' + fin.length });
  // recebimentos de contratos
  for (let i = -2; i <= 3; i++) add({ tipo: 'entrada', descricao: 'Gestão de Redes — Pro — Clínica Bella', empresa: 'Clínica Bella', valor: 1800, data: m(i, 10), categoria: 'Clientes', status: i < 0 ? 'pago' : 'a_conferir', clienteId: 'c_bella', origem: 'crm', grupoId: 'contrato_c_bella', parcela: i + 3, totalParcelas: 6 });
  for (let i = -1; i <= 4; i++) add({ tipo: 'entrada', descricao: 'Social Media — Essencial — Studio Lumi', empresa: 'Studio Lumi', valor: 1200, data: m(i, 15), categoria: 'Clientes', status: i < 0 ? 'pago' : 'a_conferir', clienteId: 'c_lumi', origem: 'crm', grupoId: 'contrato_c_lumi', parcela: i + 2, totalParcelas: 12 });
  add({ tipo: 'entrada', descricao: 'Ensaio avulso', empresa: 'Ensaio avulso', valor: 650, data: m(0, 3), categoria: 'Serviço avulso' });
  // despesas
  [['Adobe Creative Cloud', 124.9, 'Assinaturas', 'Empresa'], ['Mercado Extra', 386.4, 'Mercado', 'Pessoal'], ['Posto Shell', 210, 'Combustível', 'Pessoal'], ['Aluguel', 1600, 'Moradia', 'Pessoal'], ['Meta Ads', 300, 'Marketing / Anúncios', 'Empresa'], ['iFood', 78.5, 'Alimentação', 'Pessoal']].forEach(([n, v, c, conta], k) => {
    add({ tipo: 'saida', descricao: n, empresa: n, valor: v, data: m(0, 2 + k * 3), categoria: c, conta, forma: 'Cartão de crédito', origem: k === 5 ? 'iphone' : undefined });
    add({ tipo: 'saida', descricao: n, empresa: n, valor: v, data: m(-1, 2 + k * 3), categoria: c, conta });
  });
  for (let i = 0; i < 4; i++) add({ tipo: 'saida', descricao: 'Câmera Sony (parcelado)', empresa: 'Câmera Sony', valor: 875, data: m(i, 8), categoria: 'Equipamentos', status: i === 0 ? 'pago' : 'a_conferir', grupoId: 'g_cam', parcela: i + 1, totalParcelas: 4 });
  for (let i = 0; i < 6; i++) add({ tipo: 'saida', descricao: 'Internet fibra', empresa: 'Internet fibra', valor: 119.9, data: m(i, 12), categoria: 'Contas da casa', conta: 'Pessoal', status: i === 0 ? 'pago' : 'a_conferir', grupoId: 'g_net', parcela: i + 1, totalParcelas: 6, recorrente: true });

  const goals = {}; goals[new Date().toISOString().slice(0, 7)] = 6000;
  const sess = [3, 2, 1].map(k => ({
    id: 'ss' + k, data: d(-k), inicio: new Date(Date.now() - k * 864e5).toISOString(), fim: new Date(Date.now() - k * 864e5 + 5 * 36e5).toISOString(), duracaoTotal: 4.6 * 3600 + k * 300,
    itens: [
      { origem: 'casa', ref: 'x', titulo: 'Lavar a louça', chave: 'Lavar a louça', segundos: 1500 + k * 40, concluido: true },
      { origem: 'gestao', ref: 'y', titulo: 'Carrossel Clínica Bella', chave: 'Carrossel 5 lâminas', segundos: 2232 - k * 60, concluido: true },
      { origem: 'casa', ref: 'z', titulo: 'Lavar o banheiro', chave: 'Lavar o banheiro', segundos: 4989 + k * 100, concluido: k !== 2 }
    ]
  }));
  const criacao = [{ id: 'cr1', clienteId: 'c_bella', cliente: 'Clínica Bella', mes: new Date().toISOString().slice(0, 7), status: 'rascunho', data: d(6), formato: 'Reels', titulo: 'O que ninguém te conta sobre preenchimento', gancho: 'Você sabia que o preenchimento pode durar mais do que imagina?', roteiro: '[Close] Fala 1…\n[Corte] Fala 2…', legenda: 'Vem entender 👇', cta: 'Agende sua avaliação', hashtags: ['estetica', 'harmonizacao'], orientacoes: 'Luz natural, fundo claro.' }];

  DB.putMany('clients', clients);
  DB.putMany('tasks', tasks);
  DB.putMany('events', events);
  DB.putMany('crm', crm);
  DB.putMany('fin_lancamentos', fin);
  DB.setValue('fin_migrado', true);
  Store.setItem('plasso_monthly_goals', JSON.stringify(goals));
  DB.putMany('life_sessoes', sess);
  DB.putMany('criacao', criacao);
  const hojeISO = d(0);
  DB.putMany('life_registros', [{ id: hojeISO + '_h_agua', data: hojeISO, habitoId: 'h_agua', valor: 5 }, { id: hojeISO + '_h_leitura', data: hojeISO, habitoId: 'h_leitura', valor: 20 }]);
};
