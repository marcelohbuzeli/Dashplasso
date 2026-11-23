// =====================================================================
// Plassô — Briefing por seções (usado na ficha do cliente, no formulário
// do cliente e pelo agente de criação).
//
// Fica guardado no próprio cliente, em c.briefingV2:
//   { campos: { <chave>: { v: texto, o: origem, em: data, s: seção, l: pergunta } },
//     enviadoEm, respondidoEm, atualizadoEm }
// Origem (o): orcamento | analise | cliente | marcelo | reuniao
//
// ATENÇÃO: as chaves com cli:true também estão na função briefing_save
// (supabase/briefing-2026-11.sql). Ao criar ou renomear uma pergunta do
// cliente, atualize as duas listas.
// =====================================================================
(function () {
  'use strict';

  const SECOES = [
    { id: 'negocio', titulo: 'O negócio', icone: 'fa-store', campos: [
      { k: 'oQueFaz', l: 'O que a empresa faz', cli: true, dica: 'Explique como se fosse para alguém que nunca ouviu falar.' },
      { k: 'modelo', l: 'Modelo de negócio', cli: true, dica: 'Loja física, loja online, prestação de serviço, fábrica…', rows: 1 },
      { k: 'cidade', l: 'Cidade e abrangência', cli: true, dica: 'Onde fica e se atende só a região ou o Brasil todo.', rows: 1 },
      { k: 'produtos', l: 'Produtos e serviços, com preço aproximado', cli: true, dica: 'Um por linha. Ex.: Limpeza de pele — R$ 180' },
      { k: 'carroChefe', l: 'Carro-chefe (o que mais vende)', cli: true, rows: 2 },
      { k: 'venderMais', l: 'O que você quer vender mais', cli: true, dica: 'O produto ou serviço que vende pouco hoje e você gostaria de vender mais.', rows: 2 },
      { k: 'ticket', l: 'Ticket médio por venda', cli: true, rows: 1 },
      { k: 'diferencial', l: 'Diferenciais em relação aos concorrentes', cli: true, dica: 'Por que alguém deveria escolher você e não o concorrente?' },
      { k: 'historia', l: 'História: como e por que começou', cli: true, dica: 'Pode contar do seu jeito. Isso vira conteúdo de conexão.' }
    ] },
    { id: 'objetivos', titulo: 'Objetivos e datas', icone: 'fa-bullseye', campos: [
      { k: 'meta30', l: 'Meta para os primeiros 30 dias', cli: true, rows: 2 },
      { k: 'meta90', l: 'Meta para os próximos 60 a 90 dias', cli: true, rows: 2 },
      { k: 'expectativa', l: 'O que você espera das redes sociais', cli: true },
      { k: 'sazonalidade', l: 'Datas comerciais e meses fortes e fracos', cli: true, dica: 'Ex.: Dia das Mães é o mais forte; janeiro é o mais fraco.' },
      { k: 'datasEmpresa', l: 'Campanhas que já fazem e datas da empresa', cli: true, dica: 'Aniversário da empresa, promoções fixas, eventos…', rows: 2 }
    ] },
    { id: 'publico', titulo: 'Público', icone: 'fa-users', campos: [
      { k: 'clienteIdeal', l: 'Como é o seu cliente ideal', cli: true, dica: 'Idade, homem ou mulher, classe social, rotina, onde mora.' },
      { k: 'dores', l: 'Problemas que levam a pessoa a procurar você', cli: true, dica: 'O que está incomodando ela quando decide comprar?' },
      { k: 'desejos', l: 'O que ela deseja e como a vida muda depois', cli: true },
      { k: 'objecoes', l: 'O que faz a pessoa hesitar antes de comprar', cli: true, dica: 'Ex.: "é caro", "vou pensar", "tenho medo de doer"…' },
      { k: 'perguntas', l: 'Perguntas que os clientes sempre fazem', cli: true, dica: 'Uma por linha. Viram conteúdo pronto.' },
      { k: 'linguagem', l: 'Como o cliente fala do problema (palavras dele)', cli: false, dica: 'Expressões reais que aparecem na reunião, no WhatsApp ou nos comentários.' }
    ] },
    { id: 'marca', titulo: 'Marca e tom de voz', icone: 'fa-comment-dots', campos: [
      { k: 'tom', l: 'Tom de voz e personalidade da marca', cli: true, dica: 'Ex.: próximo e divertido, técnico e sério, acolhedor…' },
      { k: 'evitar', l: 'Palavras e assuntos que devemos evitar', cli: true, rows: 2 },
      { k: 'restricoes', l: 'Restrições: o que não pode ser dito ou mostrado', cli: true, dica: 'Regras do seu conselho profissional, antes e depois, preços, rostos de clientes…' },
      { k: 'provas', l: 'Provas: resultados, depoimentos, números', cli: true, dica: 'Casos de clientes, avaliações, anos de mercado, quantidade de atendimentos…' },
      { k: 'identidade', l: 'Identidade visual (link, cores, fontes)', cli: false, rows: 2 }
    ] },
    { id: 'producao', titulo: 'Produção', icone: 'fa-video', campos: [
      { k: 'quemAparece', l: 'Quem aparece nos conteúdos', cli: true, dica: 'Você, a equipe, só o produto… Alguém tem vergonha de gravar?', rows: 2 },
      { k: 'disponibilidade', l: 'Disponibilidade para gravar', cli: true, dica: 'Quais dias e quanto tempo por semana.', rows: 2 },
      { k: 'locais', l: 'Locais e recursos para gravar', cli: true, dica: 'Espaço da empresa, equipamentos, produtos para mostrar…', rows: 2 },
      { k: 'formatos', l: 'Formatos que você gosta ou não gosta', cli: true, dica: 'Vídeos falando, carrosséis, bastidores, trends…', rows: 2 }
    ] },
    { id: 'mercado', titulo: 'Mercado e referências', icone: 'fa-binoculars', campos: [
      { k: 'concorrentes', l: 'Principais concorrentes (com @)', cli: true, dica: 'Um por linha. Ex.: @concorrente — o mais forte da cidade' },
      { k: 'referencias', l: 'Perfis que você admira e o que gosta em cada um (com @)', cli: true, dica: 'Podem ser de qualquer área.' },
      { k: 'jaFez', l: 'O que já fez de marketing: o que funcionou e o que não', cli: true },
      { k: 'agenciaAnterior', l: 'Já teve social media ou agência? Por que encerrou?', cli: true, rows: 2 }
    ] },
    { id: 'vendas', titulo: 'Vendas', icone: 'fa-handshake', campos: [
      { k: 'destinoLead', l: 'Para onde a pessoa vai depois de ver o post', cli: true, dica: 'WhatsApp, link de agendamento, loja online, ir até a loja…', rows: 2 },
      { k: 'processoVendas', l: 'Como funciona a venda, do primeiro contato ao fechamento', cli: true },
      { k: 'origemClientes', l: 'De onde vêm os clientes hoje', cli: true, rows: 2 }
    ] },
    { id: 'diagnostico', titulo: 'Diagnóstico da Plassô', icone: 'fa-stethoscope', interno: true, campos: [
      { k: 'diagResumo', l: 'Resumo do perfil hoje', cli: false },
      { k: 'diagForte', l: 'O que o perfil já faz bem', cli: false },
      { k: 'diagProblemas', l: 'Por que o perfil ainda não vende', cli: false, rows: 4 },
      { k: 'diagOportunidades', l: 'Oportunidades', cli: false },
      { k: 'pautaReuniao', l: 'Pauta da reunião de onboarding', cli: false, rows: 4 }
    ] }
  ];

  const CAMPOS = {};
  SECOES.forEach(s => s.campos.forEach(c => { CAMPOS[c.k] = { ...c, s: s.titulo, secao: s.id }; }));

  const ORIGENS = {
    orcamento: { l: 'Orçamento', i: 'fa-globe' },
    analise: { l: 'Análise do Instagram', i: 'fa-instagram', marca: true },
    cliente: { l: 'Cliente', i: 'fa-user' },
    marcelo: { l: 'Você', i: 'fa-pen' },
    reuniao: { l: 'Reunião', i: 'fa-people-group' }
  };

  const limpo = v => String(v ?? '').trim();

  function dados(c) {
    const b = c.briefingV2 && typeof c.briefingV2 === 'object' ? c.briefingV2 : {};
    if (!b.campos || typeof b.campos !== 'object') b.campos = {};
    return b;
  }
  const valor = (c, k) => limpo(dados(c).campos[k] && dados(c).campos[k].v);

  // grava um campo (não salva no banco: quem chama faz DB.put)
  function set(c, k, v, origem) {
    const b = dados(c); const def = CAMPOS[k]; if (!def) return false;
    const novo = limpo(v); const atual = b.campos[k];
    if (!novo) { if (atual) { delete b.campos[k]; c.briefingV2 = b; return true; } return false; }
    if (atual && limpo(atual.v) === novo) return false;
    b.campos[k] = { v: novo, o: origem, em: new Date().toISOString(), s: def.s, l: def.l };
    b.atualizadoEm = new Date().toISOString();
    c.briefingV2 = b;
    return true;
  }

  function progresso(c, { soCliente = false } = {}) {
    const lista = Object.values(CAMPOS).filter(f => !soCliente || f.cli);
    const faltando = lista.filter(f => !valor(c, f.k));
    return { total: lista.length, preenchidos: lista.length - faltando.length, faltando };
  }

  // ---------- pré-preenchimento pelo orçamento do site + análise do Instagram ----------
  function acharLead(c) {
    if (!window.DB) return null;
    if (c.origemLeadId) { const l = DB.get('crm', c.origemLeadId); if (l) return l; }
    const ig = s => limpo(s).toLowerCase().replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/^@/, '').replace(/[/?#].*$/, '');
    const nome = s => limpo(s).toLowerCase();
    const leads = DB.list('crm');
    return (c.instagram && leads.find(l => ig(l.insta || l.instagram) && ig(l.insta || l.instagram) === ig(c.instagram)))
      || leads.find(l => nome(l.name) && nome(l.name) === nome(c.name))
      || null;
  }

  const lista = arr => (Array.isArray(arr) ? arr : []).map(x => limpo(typeof x === 'string' ? x : '')).filter(Boolean).map(x => '• ' + x).join('\n');

  // devolve [{k, v, o}] com o que dá para preencher; só campos vazios
  function sugestoesDoOrcamento(c, lead, analise) {
    const out = [];
    const add = (k, v, o) => { if (limpo(v) && !valor(c, k) && !out.some(x => x.k === k)) out.push({ k, v: limpo(v), o }); };
    if (lead) {
      add('cidade', lead.bairro || lead.cidade, 'orcamento');
      add('oQueFaz', lead.categoria || lead.area, 'orcamento');
      add('expectativa', lead.notas && !/^crm_/.test(lead.notas) ? lead.notas : '', 'orcamento');
      add('ticket', lead.ticket, 'orcamento');
    }
    const a = analise && analise.status !== 'erro' && analise.status !== 'analisando' ? analise : null;
    if (a) {
      add('meta30', a.objetivo, 'analise');
      add('diagResumo', [a.resumo, a.nota_perfil != null ? `Nota do perfil: ${a.nota_perfil}/10` : ''].filter(Boolean).join('\n\n'), 'analise');
      add('diagForte', lista(a.o_que_ja_faz_bem), 'analise');
      add('diagProblemas', (a.por_que_nao_vende || []).map(p => `• ${limpo(p.problema)}${p.evidencia ? `\n  Onde se vê: ${limpo(p.evidencia)}` : ''}${p.como_resolver ? `\n  Como resolver: ${limpo(p.como_resolver)}` : ''}`).join('\n'), 'analise');
      add('diagOportunidades', lista(a.oportunidades), 'analise');
      add('pautaReuniao', lista(a.perguntas_reuniao), 'analise');
    }
    return out;
  }

  function preencherDoOrcamento(c) {
    const lead = acharLead(c);
    if (!lead) return { lead: null, n: 0 };
    const analise = window.DB ? DB.get('crm_analise', lead.id) : null;
    const sug = sugestoesDoOrcamento(c, lead, analise);
    sug.forEach(s => set(c, s.k, s.v, s.o));
    if (!c.origemLeadId) c.origemLeadId = lead.id;
    return { lead, analise, n: sug.length };
  }

  // texto corrido (para copiar, para o Jarvis e para o agente de criação)
  function texto(c) {
    return SECOES.map(s => {
      const linhas = s.campos.filter(f => valor(c, f.k)).map(f => `${f.l}:\n${valor(c, f.k)}`);
      return linhas.length ? `## ${s.titulo}\n${linhas.join('\n\n')}` : '';
    }).filter(Boolean).join('\n\n');
  }

  function briefingUrl(client) {
    const base = location.href.replace(/[^/]*$/, '');
    return base + 'briefing.html?t=' + client.portalToken;
  }

  // ---------- editor da ficha do cliente (aba Briefing) ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const dataCurta = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';

  function estiloEditor() {
    if (document.getElementById('bf-css')) return;
    const st = document.createElement('style'); st.id = 'bf-css';
    st.textContent = `
      .bf-sec { border: 1px solid var(--line); border-radius: var(--r-sm); background: rgba(255,255,255,.02); }
      .bf-sec > summary { list-style: none; cursor: pointer; padding: 14px 16px; display: flex; align-items: center; gap: 10px; }
      .bf-sec > summary::-webkit-details-marker { display: none; }
      .bf-sec > summary .bf-chev { margin-left: auto; transition: transform .2s; color: var(--ink-3); font-size: 12px; }
      .bf-sec[open] > summary .bf-chev { transform: rotate(180deg); }
      .bf-sec .bf-body { padding: 0 16px 16px; display: grid; gap: 14px; }
      .bf-campo > .bf-lbl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--ink-2); margin-bottom: 6px; }
      .bf-campo .pill { font-size: 10.5px; padding: 1px 7px; }
      .bf-campo .tiny { margin-top: 4px; }
      .bf-campo.vazio textarea { border-style: dashed; }
      .bf-oculto { display: none !important; }
      .bf-sug { display: grid; grid-template-columns: auto 1fr; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: var(--r-xs); }
      .bf-sug pre { white-space: pre-wrap; font: inherit; margin: 4px 0 0; color: var(--ink-2); font-size: 13px; }
      .bf-sug .bf-antes { color: var(--ink-3); text-decoration: line-through; }
    `;
    document.head.appendChild(st);
  }

  function pillOrigem(o, em) {
    const x = ORIGENS[o]; if (!x) return '';
    return `<span class="pill" title="${esc(x.l)}${em ? ' · ' + dataCurta(em) : ''}"><i class="fa-${x.marca ? 'brands' : 'solid'} ${x.i}"></i>${esc(x.l)}</span>`;
  }

  // HTML da aba (sem os botões de salvar, que são da ficha)
  function editorHtml(c) {
    estiloEditor();
    const b = dados(c); const p = progresso(c); const pc = progresso(c, { soCliente: true });
    const status = b.respondidoEm ? `<span class="pill pill-ok"><i class="fa-solid fa-check"></i>Cliente respondeu em ${dataCurta(b.respondidoEm)}</span>`
      : b.enviadoEm ? `<span class="pill pill-warn"><i class="fa-regular fa-clock"></i>Enviado ao cliente em ${dataCurta(b.enviadoEm)}</span>`
      : '<span class="pill">Ainda não enviado ao cliente</span>';
    return `
      <div class="card card-tight">
        <div class="row-between" style="flex-wrap:wrap;gap:10px">
          <div><div class="h3" data-bf-prog>${p.preenchidos} de ${p.total} respondidas</div><div class="small muted mt-1">${pc.total - pc.preenchidos} pergunta${pc.total - pc.preenchidos !== 1 ? 's' : ''} do cliente sem resposta</div></div>
          ${status}
        </div>
        <div class="bar mt-3"><span data-bf-bar style="width:${Math.round(p.preenchidos * 100 / p.total)}%"></span></div>
        <div class="wrap-row mt-3">
          <button class="btn btn-white btn-sm" data-bf="whats"><i class="fa-brands fa-whatsapp"></i> Enviar ao cliente</button>
          <button class="btn btn-ghost btn-sm" data-bf="copiar"><i class="fa-solid fa-link"></i> Copiar link</button>
          <button class="btn btn-ghost btn-sm" data-bf="orcamento"><i class="fa-solid fa-globe"></i> Puxar do orçamento</button>
          <button class="btn btn-ghost btn-sm" data-bf="ia"><i class="fa-solid fa-wand-magic-sparkles"></i> Organizar reunião ou texto (IA)</button>
        </div>
      </div>
      <label class="field"><span>Objetivo principal</span><input class="input" name="objetivo" value="${esc(c.objetivo || '')}" placeholder="Ex.: gerar agendamentos"></label>
      <div class="row-between" style="flex-wrap:wrap;gap:10px">
        <div class="seg" data-bf-fil><button data-f="todas" class="on">Todas</button><button data-f="faltando">Faltando</button></div>
        <button class="btn btn-ghost btn-sm" data-bf="abrir-tudo"><i class="fa-solid fa-up-down"></i> Abrir todas</button>
      </div>
      ${SECOES.map((s, i) => {
        const n = s.campos.filter(f => valor(c, f.k)).length;
        return `<details class="bf-sec" data-sec="${s.id}" ${i === 0 ? 'open' : ''}>
          <summary><i class="fa-solid ${s.icone} muted"></i><span class="h3" style="font-size:15px">${esc(s.titulo)}</span><span class="small muted" data-sec-n>${n}/${s.campos.length}</span>${s.interno ? '<span class="pill">Só você vê</span>' : ''}<i class="fa-solid fa-chevron-down bf-chev"></i></summary>
          <div class="bf-body">${s.campos.map(f => {
            const cur = b.campos[f.k]; const v = cur ? cur.v : '';
            return `<div class="bf-campo ${v ? '' : 'vazio'}" data-campo="${f.k}">
              <div class="bf-lbl"><span>${esc(f.l)}</span>${!f.cli && !s.interno ? '<span class="pill">Reunião</span>' : ''}<span data-orig>${cur ? pillOrigem(cur.o, cur.em) : ''}</span></div>
              <textarea class="textarea" name="bf_${f.k}" rows="${f.rows || 3}" placeholder="${esc(f.dica || '')}">${esc(v)}</textarea>
            </div>`;
          }).join('')}</div>
        </details>`;
      }).join('')}
      <label class="field"><span>Anotações livres (o agente de criação também lê)</span><textarea class="textarea" name="briefing" rows="6" placeholder="Qualquer coisa que não coube nas perguntas acima…">${esc(c.briefing || '')}</textarea></label>`;
  }

  // liga os botões da aba. ctx: { sheet, cliente: () => cliente atual, toast }
  function ligarEditor(s, getCliente) {
    const area = k => s.$(`[name="bf_${k}"]`);
    const atualizarContagem = () => {
      let feitos = 0; const total = Object.keys(CAMPOS).length;
      s.$$('.bf-campo').forEach(el => { const ok = !!limpo(el.querySelector('textarea').value); el.classList.toggle('vazio', !ok); if (ok) feitos++; });
      s.$$('.bf-sec').forEach(sec => { const t = sec.querySelectorAll('.bf-campo').length; const n = [...sec.querySelectorAll('textarea')].filter(x => limpo(x.value)).length; sec.querySelector('[data-sec-n]').textContent = `${n}/${t}`; });
      const pr = s.$('[data-bf-prog]'); if (pr) pr.textContent = `${feitos} de ${total} respondidas`;
      const bar = s.$('[data-bf-bar]'); if (bar) bar.style.width = Math.round(feitos * 100 / total) + '%';
      aplicarFiltro();
    };
    let filtro = 'todas';
    const aplicarFiltro = () => {
      s.$$('.bf-campo').forEach(el => el.classList.toggle('bf-oculto', filtro === 'faltando' && !el.classList.contains('vazio') && !el.dataset.recem));
      s.$$('.bf-sec').forEach(sec => sec.classList.toggle('bf-oculto', filtro === 'faltando' && !sec.querySelector('.bf-campo:not(.bf-oculto)')));
    };
    s.$$('[data-bf-fil] button').forEach(btn => btn.onclick = () => {
      filtro = btn.dataset.f; s.$$('[data-bf-fil] button').forEach(x => x.classList.toggle('on', x === btn));
      s.$$('.bf-campo').forEach(el => delete el.dataset.recem);
      if (filtro === 'faltando') s.$$('.bf-sec').forEach(sec => sec.open = true);
      aplicarFiltro();
    });
    s.$$('.bf-campo textarea').forEach(t => t.addEventListener('input', () => { t.dataset.o = 'marcelo'; t.closest('.bf-campo').dataset.recem = '1'; atualizarContagem(); }));
    const abrirTudo = s.$('[data-bf="abrir-tudo"]');
    if (abrirTudo) abrirTudo.onclick = () => { const abrir = s.$$('.bf-sec').some(x => !x.open); s.$$('.bf-sec').forEach(x => x.open = abrir); };

    // coloca um valor no formulário (fica pendente até Salvar)
    const preencher = (k, v, o) => {
      const t = area(k); if (!t) return;
      t.value = v; t.dataset.o = o;
      const box = t.closest('.bf-campo'); box.dataset.recem = '1';
      box.querySelector('[data-orig]').innerHTML = pillOrigem(o) + '<span class="pill pill-warn">não salvo</span>';
      box.closest('details').open = true;
    };

    const btn = (n, fn) => { const el = s.$(`[data-bf="${n}"]`); if (el) el.onclick = fn; };

    btn('orcamento', () => {
      const c = getCliente();
      const lead = acharLead(c);
      if (!lead) { App.toast('Não achei um orçamento ou lead do CRM com este nome ou Instagram. Preencha à mão.', 'warn'); return; }
      const analise = DB.get('crm_analise', lead.id);
      // compara com o que está no formulário agora (não só com o salvo)
      const tmp = { briefingV2: { campos: {} } };
      Object.keys(CAMPOS).forEach(k => { const t = area(k); if (t && limpo(t.value)) tmp.briefingV2.campos[k] = { v: t.value }; });
      const sug = sugestoesDoOrcamento(tmp, lead, analise);
      if (!c.origemLeadId) { c.origemLeadId = lead.id; DB.put('clients', c); }
      if (!sug.length) { App.toast(analise ? 'O orçamento não tem nada novo para os campos vazios.' : 'Achei o lead, mas ele não tem análise do Instagram nem dados novos.', 'info'); return; }
      sug.forEach(x => preencher(x.k, x.v, x.o));
      atualizarContagem();
      App.toast(`${sug.length} campo${sug.length !== 1 ? 's' : ''} preenchido${sug.length !== 1 ? 's' : ''} pelo orçamento de ${lead.name || lead.nomeCompleto}. Confira e salve.`, 'ok');
    });

    const garantirLink = async () => { try { await DB.reload(['clients']); } catch (e) {} const c = getCliente(); window.Integracao && Integracao.ensurePortalToken(c); return DB.get('clients', c.id); };
    btn('copiar', async () => { const c = await garantirLink(); const url = briefingUrl(c); try { await navigator.clipboard.writeText(url); App.toast('Link do briefing copiado.', 'ok'); } catch (e) { prompt('Copie o link:', url); } });
    btn('whats', async () => {
      const w = (s.$('[name=whatsapp]') && s.$('[name=whatsapp]').value.trim()) || getCliente().whatsapp;
      if (!w) { App.toast('Preencha o WhatsApp do cliente na aba Contrato.', 'warn'); return; }
      const janela = window.open('', '_blank'); // abre já no clique (o Safari bloqueia depois de esperar o banco)
      const c = await garantirLink();
      const b = dados(c); b.enviadoEm = new Date().toISOString(); c.briefingV2 = b; c.whatsapp = w; DB.put('clients', c);
      const pc = progresso(c, { soCliente: true });
      const texto = `Oi, ${c.name}! Para eu criar conteúdos que realmente vendem, preciso conhecer bem o seu negócio 🙌\n\nPreparei um briefing rápido${pc.preenchidos ? ' e já deixei preenchido o que eu sei. É só conferir e completar o resto' : ''}. Dá para parar e continuar depois, as respostas ficam salvas:\n${briefingUrl(c)}`;
      const link = Integracao.whatsappLink(c, texto);
      if (janela) janela.location.href = link; else window.open(link, '_blank');
    });

    btn('ia', () => abrirIA(getCliente(), (k, v) => { preencher(k, v, 'reuniao'); atualizarContagem(); }, () => {
      const atual = {}; Object.keys(CAMPOS).forEach(k => { const t = area(k); atual[k] = t ? t.value : ''; }); return atual;
    }, () => (s.$('[name=briefing]') || {}).value || ''));

    atualizarContagem();
  }

  // grava no cliente o que foi editado na aba (chamar no Salvar da ficha)
  function coletar(s, c) {
    let n = 0;
    Object.keys(CAMPOS).forEach(k => {
      const t = s.$(`[name="bf_${k}"]`); if (!t) return;
      // só o que foi mexido nesta ficha: o cliente pode ter respondido outros campos enquanto ela estava aberta
      if (t.value === t.defaultValue) return;
      if (set(c, k, t.value, t.dataset.o || 'marcelo')) n++;
    });
    return n;
  }

  // ---------- IA: organizar transcrição / anotações / briefing antigo nos campos ----------
  function abrirIA(c, aplicar, valoresAtuais, anotacoes) {
    const temAnot = !!limpo(anotacoes());
    const m = UI.sheet({
      title: 'Organizar com IA', wide: true,
      html: `<p class="small soft" style="margin-top:-4px">Cole a transcrição ou as anotações da reunião (ou um briefing antigo). A IA distribui o que encontrar nas perguntas certas. Você escolhe o que aplicar.</p>
        <label class="field mt-3"><span>Texto</span><textarea class="textarea" data-txt rows="12" placeholder="Cole aqui…"></textarea></label>
        ${temAnot ? '<button class="btn btn-ghost btn-sm mt-2" data-usar-anot><i class="fa-solid fa-file-lines"></i> Usar as anotações livres deste cliente</button>' : ''}
        <div data-res class="stack mt-4"></div>`,
      foot: '<button class="btn btn-ghost" data-close>Fechar</button><button class="btn btn-white" data-ir><i class="fa-solid fa-wand-magic-sparkles"></i> Organizar</button>'
    });
    const ua = m.$('[data-usar-anot]'); if (ua) ua.onclick = () => { m.$('[data-txt]').value = anotacoes(); };
    m.$('[data-ir]').onclick = async () => {
      const txt = limpo(m.$('[data-txt]').value);
      if (txt.length < 40) { App.toast('Cole um texto maior.', 'warn'); return; }
      const atual = valoresAtuais();
      const bt = m.$('[data-ir]'); bt.disabled = true; bt.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Organizando… (até 1 min)';
      try {
        const campos = Object.values(CAMPOS).map(f => ({ k: f.k, l: f.l, secao: f.s, atual: limpo(atual[f.k]) }));
        const r = await UI.chamarFuncao('extrair-briefing', { clienteId: c.id, texto: txt.slice(0, 120000), campos });
        mostrarSugestoes(m, r, atual, aplicar);
      } catch (e) {
        App.toast(e.message === 'LOCAL' ? 'A IA só funciona com o banco configurado.' : e.message, 'warn');
      } finally { bt.disabled = false; bt.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Organizar'; }
    };
  }

  function mostrarSugestoes(m, r, atual, aplicar) {
    const sug = (r.campos || []).filter(x => CAMPOS[x.k] && limpo(x.v) && limpo(x.v) !== limpo(atual[x.k]));
    const res = m.$('[data-res]');
    if (!sug.length) { res.innerHTML = '<div class="empty">A IA não encontrou nada novo para as perguntas.</div>'; return; }
    res.innerHTML = `<div class="row-between"><div class="h3">${sug.length} sugest${sug.length !== 1 ? 'ões' : 'ão'}</div><button class="btn btn-ghost btn-sm" data-todas>Marcar todas</button></div>
      ${r.observacoes ? `<div class="card card-tight small soft">${esc(r.observacoes)}</div>` : ''}
      ${sug.map((x, i) => `<label class="bf-sug"><input type="checkbox" data-i="${i}" checked>
        <div><div class="small"><b>${esc(CAMPOS[x.k].l)}</b> <span class="muted">· ${esc(CAMPOS[x.k].s)}</span></div>
        ${limpo(atual[x.k]) ? `<pre class="bf-antes">${esc(atual[x.k])}</pre>` : ''}<pre>${esc(x.v)}</pre></div></label>`).join('')}
      <button class="btn btn-white" data-aplicar><i class="fa-solid fa-check"></i> Aplicar marcadas</button>`;
    res.querySelector('[data-todas]').onclick = () => { const cbs = [...res.querySelectorAll('[data-i]')]; const marcar = cbs.some(cb => !cb.checked); cbs.forEach(cb => cb.checked = marcar); };
    res.querySelector('[data-aplicar]').onclick = () => {
      const marcadas = [...res.querySelectorAll('[data-i]:checked')].map(cb => sug[Number(cb.dataset.i)]);
      marcadas.forEach(x => aplicar(x.k, x.v));
      m.close();
      App.toast(`${marcadas.length} campo${marcadas.length !== 1 ? 's' : ''} aplicado${marcadas.length !== 1 ? 's' : ''}. Confira e clique em Salvar.`, 'ok');
    };
  }

  window.Briefing = { SECOES, CAMPOS, ORIGENS, dados, valor, set, progresso, acharLead, sugestoesDoOrcamento, preencherDoOrcamento, texto, briefingUrl, editorHtml, ligarEditor, coletar };
})();
