/* =====================================================================
   Empresa — editores compartilhados (Tasks, Calendário, Clientes, Visão geral)
   Coleção "tasks": conteúdos (kind post) e compromissos (reunião, follow-up, evento).
   Mantém compatibilidade com os campos antigos (headline, client, type, date,
   status, drive, roteiro, legenda, observacoes, notes, isRejected...).
   ===================================================================== */
(function () {
  'use strict';
  const { esc, T, STATUS, FORMATOS } = UI;

  const nomesClientes = () => [...new Set([...DB.list('clients').map(c => c.name), ...DB.list('crm').map(l => l.name)].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const datalist = () => `<datalist id="dl-clientes">${nomesClientes().map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;

  function card(t, { showClient = true } = {}) {
    const st = T.statusInfo(T.status(t));
    return `
      <button class="card card-tight card-link tcard ${t.isRejected ? 'rejected' : ''}" data-task="${esc(t.id)}" style="text-align:left;width:100%">
        <div class="row-between" style="align-items:flex-start">
          <div class="title">${esc(T.titulo(t))}</div>
          <span class="pill ${st.pill}" style="flex-shrink:0">${st.label}</span>
        </div>
        <div class="row mt-2 small muted" style="flex-wrap:wrap;gap:6px 10px">
          ${showClient && t.client ? `<span><i class="fa-solid fa-user tiny"></i> ${esc(t.client)}</span>` : ''}
          ${t.type ? `<span><i class="fa-solid fa-clapperboard tiny"></i> ${esc(t.type)}</span>` : ''}
          ${t.date ? `<span><i class="fa-regular fa-calendar tiny"></i> ${UI.quando(t.date)}</span>` : ''}
          ${t.drive ? '<span><i class="fa-brands fa-google-drive tiny"></i> Drive</span>' : ''}
        </div>
        ${t.isRejected && t.notes ? `<div class="small mt-2" style="color:#ff9aa7">${esc(String(t.notes).replace(/^Reprovado pelo cliente:\s*/, 'Cliente pediu: '))}</div>` : ''}
      </button>`;
  }

  // ---------- editor de conteúdo ----------
  function editarConteudo(id, defaults = {}, onDone) {
    const novo = !id;
    const t = novo ? { id: T.novoId(), kind: 'post', status: 'afazer', isRejected: false, type: 'Reels', headline: '', client: '', date: UI.hoje(), ...defaults } : { ...DB.get('tasks', id) };
    if (!t || !t.id) return App.toast('Conteúdo não encontrado.', 'err');
    const st = T.status(t);
    const s = UI.sheet({
      title: novo ? 'Novo conteúdo' : 'Conteúdo',
      wide: true,
      html: `${datalist()}
        <div class="form-grid">
          <label class="field full"><span>Título / headline</span><input class="input" name="headline" value="${esc(t.headline || '')}" placeholder="Ex.: 3 sinais de que sua pele precisa de cuidado"></label>
          <label class="field"><span>Cliente</span><input class="input" name="client" list="dl-clientes" value="${esc(t.client || '')}" autocomplete="off"></label>
          <label class="field"><span>Formato</span><select class="select" name="type">${[...new Set([...FORMATOS, t.type].filter(Boolean))].map(f => `<option ${f === t.type ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
          <label class="field"><span>Data da postagem</span><input class="input" type="date" name="date" value="${esc(t.date || '')}"></label>
          <label class="field"><span>Status</span><select class="select" name="status">${STATUS.map(x => `<option value="${x.id}" ${x.id === st ? 'selected' : ''}>${x.label}</option>`).join('')}</select></label>
          <label class="field full"><span>Pasta do Drive</span><input class="input" type="url" name="drive" value="${esc(t.drive || '')}" placeholder="https://drive.google.com/…"></label>
          <label class="field full"><span>Roteiro</span><textarea class="textarea" name="roteiro" rows="6">${esc(t.roteiro || '')}</textarea></label>
          <label class="field full"><span>Legenda</span><textarea class="textarea" name="legenda" rows="4">${esc(t.legenda || t.caption || '')}</textarea></label>
          <label class="field full"><span>Observações</span><textarea class="textarea" name="observacoes" rows="2">${esc(t.observacoes || '')}</textarea></label>
          ${t.isRejected ? `<div class="full card card-tight" style="border-color:rgba(255,90,110,.4)"><div class="small" style="color:#ff9aa7"><i class="fa-solid fa-rotate-left"></i> ${esc(t.notes || 'Ajuste pedido pelo cliente')}</div><label class="check mt-2 small"><input type="checkbox" name="resolvido"> Ajuste feito (tirar o aviso)</label></div>` : ''}
        </div>
        ${t.tempoGasto ? `<p class="muted small mt-3"><i class="fa-solid fa-stopwatch"></i> Tempo gasto no Modo Trabalho: ${Math.round(t.tempoGasto / 60)} min</p>` : ''}`,
      foot: `${novo ? '' : '<button class="btn btn-danger" data-del><i class="fa-solid fa-trash"></i></button>'}${t.drive ? `<a class="btn btn-ghost" href="${esc(t.drive)}" target="_blank" rel="noopener"><i class="fa-brands fa-google-drive"></i> Drive</a>` : ''}<button class="btn btn-white" data-save>Salvar</button>`
    });
    s.$('[data-save]').onclick = () => {
      const f = UI.formData(s.el);
      if (!f.headline.trim()) { App.toast('Dê um título ao conteúdo.', 'warn'); return; }
      const orig = novo ? {} : DB.get('tasks', id);
      const out = { ...orig, ...t, headline: f.headline.trim(), client: f.client.trim(), type: f.type, date: f.date, drive: f.drive.trim(), roteiro: f.roteiro, legenda: f.legenda, caption: f.legenda, observacoes: f.observacoes };
      out.kind = 'post';
      // status escolhido à mão fica fixo; se não mexeu, continua automático (urgente quando faltar 48h)
      if (novo || f.status !== st) { out.status = f.status; out.manuallyMovedToPronto = !novo || f.status !== 'afazer'; }
      if (f.resolvido || f.status === 'pronto' || f.status === 'aprovadas') { out.isRejected = false; if (f.resolvido) out.notes = ''; }
      DB.put('tasks', out);
      s.close(); App.toast(novo ? 'Conteúdo criado.' : 'Conteúdo salvo.', 'ok'); onDone && onDone(out);
    };
    const del = s.$('[data-del]');
    if (del) del.onclick = () => { if (!confirm(`Excluir "${T.titulo(t)}"?`)) return; DB.remove('tasks', id); s.close(); App.toast('Excluído.', 'ok'); onDone && onDone(null); };
    return s;
  }

  // ---------- editor de compromisso (reunião, follow-up, evento) ----------
  function editarCompromisso(id, defaults = {}, onDone, src = 'tasks') {
    const novo = !id;
    let t;
    if (novo) t = { id: T.novoId(), kind: 'reuniao', date: UI.hoje(), time: '', client: '', headline: '', ...defaults };
    else if (src === 'events') { const e = DB.get('events', id); t = { id: e.id, kind: 'evento', date: e.date, time: e.time || '', headline: e.title || '', client: '', descricao: e.descricao || '', _src: 'events' }; }
    else { const o = DB.get('tasks', id); t = { ...o, kind: T.kind(o), time: T.hora(o), headline: T.titulo(o) }; }
    const s = UI.sheet({
      title: novo ? 'Novo compromisso' : 'Compromisso',
      html: `${datalist()}
        <div class="seg mb-3" data-kinds>${['reuniao', 'follow', 'evento'].map(k => `<button type="button" data-k="${k}" class="${t.kind === k ? 'on' : ''}"><i class="fa-solid ${T.kindInfo(k).icon}"></i>${T.kindInfo(k).label}</button>`).join('')}</div>
        <div class="form-grid">
          <label class="field full"><span>Título</span><input class="input" name="headline" value="${esc(t.headline || '')}" placeholder="Ex.: Reunião de apresentação"></label>
          <label class="field full"><span>Cliente / contato</span><input class="input" name="client" list="dl-clientes" value="${esc(t.client || '')}" autocomplete="off"></label>
          <label class="field"><span>Data</span><input class="input" type="date" name="date" value="${esc(t.date || '')}"></label>
          <label class="field"><span>Hora</span><input class="input" type="time" name="time" value="${esc(t.time || '')}"></label>
          <label class="field full"><span>Anotações</span><textarea class="textarea" name="descricao" rows="3">${esc(t.descricao || t.observacoes || '')}</textarea></label>
        </div>`,
      foot: `${novo ? '' : '<button class="btn btn-danger" data-del><i class="fa-solid fa-trash"></i></button>'}<button class="btn btn-white" data-save>Salvar</button>`
    });
    let kind = t.kind;
    s.$$('[data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; s.$$('[data-k]').forEach(x => x.classList.toggle('on', x === b)); });
    s.$('[data-save]').onclick = () => {
      const f = UI.formData(s.el);
      if (!f.date) { App.toast('Escolha a data.', 'warn'); return; }
      const titulo = f.headline.trim() || (kind === 'reuniao' ? 'Reunião' : kind === 'follow' ? 'Follow-up' : 'Evento') + (f.client ? ' ' + f.client.trim() : '');
      if (t._src === 'events') DB.remove('events', t.id); // migra evento antigo para a coleção tasks
      const orig = (!novo && t._src !== 'events') ? DB.get('tasks', id) : {};
      const out = {
        ...orig, id: t._src === 'events' ? T.novoId() : t.id, kind, headline: titulo, client: f.client.trim(), date: f.date, time: f.time,
        caption: f.time ? `Agendado às ${f.time}` : '', descricao: f.descricao, observacoes: f.descricao,
        notes: kind === 'reuniao' ? 'crm_meeting' : kind === 'follow' ? 'crm_follow' : 'crm_evento',
        type: orig.type || 'Evento', status: orig.status || 'afazer', isRejected: false
      };
      DB.put('tasks', out);
      s.close(); App.toast('Compromisso salvo.', 'ok'); onDone && onDone(out);
    };
    const del = s.$('[data-del]');
    if (del) del.onclick = () => { if (!confirm('Excluir este compromisso?')) return; DB.remove(t._src === 'events' ? 'events' : 'tasks', id); s.close(); App.toast('Excluído.', 'ok'); onDone && onDone(null); };
    return s;
  }

  function abrir(id, onDone, src) {
    if (src === 'events') return editarCompromisso(id, {}, onDone, 'events');
    const t = DB.get('tasks', id); if (!t) return;
    return T.isConteudo(t) ? editarConteudo(id, {}, onDone) : editarCompromisso(id, {}, onDone);
  }

  // escolher o que criar num dia
  function novoNoDia(date, onDone, defaults = {}) {
    const s = UI.sheet({
      title: 'Adicionar em ' + UI.dataBR(date),
      html: `<div class="list">
        ${[['post', 'Conteúdo / postagem', 'Reels, carrossel, story…'], ['reuniao', 'Reunião', 'Com cliente ou lead'], ['follow', 'Follow-up', 'Lembrete de contato'], ['evento', 'Evento', 'Gravação, compromisso, prazo…']].map(([k, l, d]) => `
          <button class="item item-btn" data-k="${k}"><div class="icon accent"><i class="fa-solid ${T.kindInfo(k).icon}"></i></div><div class="grow"><div class="title">${l}</div><div class="sub">${d}</div></div><i class="fa-solid fa-chevron-right muted"></i></button>`).join('')}
      </div>`
    });
    s.$$('[data-k]').forEach(b => b.onclick = () => {
      s.close();
      setTimeout(() => b.dataset.k === 'post' ? editarConteudo(null, { date, ...defaults }, onDone) : editarCompromisso(null, { date, kind: b.dataset.k, ...defaults }, onDone), 220);
    });
  }

  function mover(id, status) {
    const t = DB.get('tasks', id); if (!t) return;
    t.status = status;
    t.manuallyMovedToPronto = true; // status escolhido à mão
    if (status === 'aprovadas' || status === 'pronto') t.isRejected = false;
    DB.put('tasks', t);
  }

  window.Empresa = { card, editarConteudo, editarCompromisso, abrir, novoNoDia, mover, nomesClientes };
})();
