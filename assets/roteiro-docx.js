/* Exporta roteiros de vídeo para gravação em .docx (Word), sem bibliotecas externas.
   Estrutura: cliente e mês de gravação, legenda de cores (quem fala / videomaker), um bloco
   por roteiro (título e takes só com direção do videomaker e falas) e, no fim,
   o teleprompter só com as falas.
   Uso: RoteiroDocx.baixar(conteudos, { cliente, mes }) */
(function () {
  const COR = { fala: 'C00000', video: '7030A0', cinza: '777777' };
  const EMOJI_FONT = 'Apple Color Emoji';

  // ---------- XML ----------
  const xesc = s => String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function run(texto, o = {}) {
    if (texto === '' || texto == null) return '';
    const font = o.emoji ? EMOJI_FONT : 'Arial';
    const sz = o.sz || 22;
    const rpr = `<w:rFonts w:ascii="${font}" w:eastAsia="${font}" w:hAnsi="${font}" w:cs="${font}"/>` +
      (o.b ? '<w:b/><w:bCs/>' : '') + (o.i ? '<w:i/><w:iCs/>' : '') +
      `<w:color w:val="${o.cor || '000000'}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` +
      (o.fundo ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fundo}"/>` : '');
    // quebras de linha dentro do mesmo parágrafo
    return String(texto).split('\n').map((t, i) => (i ? `<w:r><w:rPr>${rpr}</w:rPr><w:br/></w:r>` : '') +
      `<w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${xesc(t)}</w:t></w:r>`).join('');
  }
  function par(runs, o = {}) {
    const ppr = (o.borda ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>' : '') +
      `<w:spacing w:before="${o.antes || 0}" w:after="${o.depois == null ? 100 : o.depois}"${o.linha ? ` w:line="${o.linha}" w:lineRule="auto"` : ''}/>` +
      (o.centro ? '<w:jc w:val="center"/>' : '') + (o.quebraAntes ? '<w:pageBreakBefore/>' : '') + (o.junto ? '<w:keepNext/>' : '');
    return `<w:p><w:pPr>${ppr}</w:pPr>${runs || ''}</w:p>`;
  }
  // parágrafo "emoji + rótulo em negrito + texto"
  const linha = (emoji, rotulo, texto, o = {}) => par(
    (emoji ? run(emoji, { emoji: true, cor: o.cor, b: o.bRotulo }) + run(' ', { cor: o.cor }) : '') +
    (rotulo ? run(rotulo + ' ', { b: true, cor: o.cor }) : '') +
    run(texto, { cor: o.cor, b: o.bTexto }), o);
  const vazio = () => par('');
  const divisor = () => par('', { borda: true, antes: 120, depois: 200 });

  // ---------- leitura do roteiro ----------
  const PREFIXOS = [
    [/^(texto na tela|texto|lettering|legenda na tela|tela)\s*:\s*/i, 'tela'],
    [/^(editor|edi[cç][aã]o|p[oó]s)\s*:\s*/i, 'editor'],
    [/^(cena|v[ií]deo|imagem|b-?roll|c[aâ]mera|plano|take\s*\d*)\s*[:—-]\s*/i, 'video'],
    [/^(fala|narra[cç][aã]o|locu[cç][aã]o|voz|off)\s*:\s*/i, 'fala'],
    [/^(gancho|cta)\s*:\s*/i, 'fala'],
  ];
  const limparFala = s => s.replace(/^[-–•*]\s*/, '').replace(/^["“”']+|["“”']+$/g, '').trim();

  // devolve uma lista de itens {tipo: 'video'|'fala'|'tela'|'editor', texto}
  function itensDoRoteiro(roteiro) {
    const itens = [];
    String(roteiro || '').split(/\r?\n/).forEach(bruta => {
      let l = bruta.trim();
      if (!l) return;
      for (const [re, tipo] of PREFIXOS) {
        if (re.test(l)) {
          const resto = l.replace(re, '').trim();
          if (tipo !== 'fala') { if (resto) itens.push({ tipo, texto: resto }); return; }
          l = resto; break;
        }
      }
      // indicações de cena entre colchetes ou parênteses no começo/meio da linha
      const re = /\[([^\]]+)\]/g; let m, ultimo = 0, achou = false;
      while ((m = re.exec(l))) {
        const antes = limparFala(l.slice(ultimo, m.index));
        if (antes) itens.push({ tipo: 'fala', texto: antes });
        itens.push({ tipo: 'video', texto: m[1].trim() });
        ultimo = re.lastIndex; achou = true;
      }
      const resto = limparFala(achou ? l.slice(ultimo) : l);
      if (resto) itens.push({ tipo: 'fala', texto: resto });
    });
    return itens;
  }

  const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  // agrupa em takes: cada indicação de cena que vem depois de uma fala abre um take novo
  function montarTakes(x) {
    // só direção do videomaker e falas (texto na tela e notas de edição ficam de fora)
    const itens = itensDoRoteiro(x.roteiro).filter(i => i.tipo === 'video' || i.tipo === 'fala');
    const takes = [];
    let atual = null;
    const novo = nome => (atual = { nome, itens: [] }, takes.push(atual), atual);
    const temFala = t => t.itens.some(i => i.tipo === 'fala');
    const jaTem = txt => itens.some(i => i.tipo === 'fala' && norm(i.texto).includes(norm(txt).slice(0, 60)));

    if (x.gancho && !jaTem(x.gancho)) novo('GANCHO').itens.push({ tipo: 'fala', texto: limparFala(x.gancho) });
    itens.forEach(it => {
      if (!atual || (it.tipo === 'video' && temFala(atual))) novo(it.tipo === 'video' ? it.texto : '');
      atual.itens.push(it);
    });
    if (x.cta && !jaTem(x.cta)) novo('CTA').itens.push({ tipo: 'fala', texto: limparFala(x.cta) });
    if (takes.length) takes[0].nome = 'GANCHO';
    const ult = takes[takes.length - 1];
    if (takes.length > 1 && x.cta && ult.itens.some(i => i.tipo === 'fala' && norm(i.texto).includes(norm(x.cta).slice(0, 60)))) ult.nome = 'CTA';
    return takes;
  }
  const nomeTake = n => {
    const curto = String(n || '').split(/[,;:.(]/)[0].trim().split(/\s+/).slice(0, 6).join(' ');
    return curto.toUpperCase();
  };

  // ---------- documento ----------
  function blocoRoteiro(x, n, primeiro) {
    const out = [];
    const takes = montarTakes(x);
    const num = String(n).padStart(2, '0');
    out.push(par(run('🎬', { emoji: true, b: true, sz: 26, fundo: 'FFFF00' }) +
      run(` ROTEIRO ${num} — ${String(x.titulo || 'Sem título').toUpperCase()}`, { b: true, sz: 26, fundo: 'FFFF00' }),
      { quebraAntes: !primeiro, junto: true }));
    out.push(divisor());

    if (!takes.length) out.push(linha('', '', 'Este conteúdo ainda não tem roteiro escrito.', { cor: COR.cinza }));
    takes.forEach((t, i) => {
      const titulo = ` TAKE ${i + 1}${t.nome ? ' — ' + nomeTake(t.nome) : ''}`;
      out.push(par(run('🎬', { emoji: true, b: true }) + run(titulo, { b: true }), { antes: 200, junto: true }));
      t.itens.forEach(it => {
        if (it.tipo === 'video') out.push(linha('📹', '', it.texto, { cor: COR.video }));
        else out.push(par(run('🎙️', { emoji: true, b: true, cor: COR.fala }) + run(' Fala: ', { b: true, cor: COR.fala }) + run(`“${it.texto}”`, { cor: COR.fala })));
      });
    });
    return out.join('');
  }

  function teleprompter(lista, ctx) {
    const out = [par(run('TELEPROMPTER', { b: true, sz: 32 }), { quebraAntes: true, centro: true, depois: 80 }),
      par(run(`${ctx.cliente || ''}${ctx.mes ? ' · ' + ctx.mes : ''} — só as falas, na ordem`, { cor: COR.cinza, sz: 20 }), { centro: true, depois: 300 })];
    lista.forEach((x, i) => {
      const falas = montarTakes(x).flatMap(t => t.itens.filter(it => it.tipo === 'fala').map(it => it.texto));
      out.push(par(run(`ROTEIRO ${String(i + 1).padStart(2, '0')} — ${String(x.titulo || '').toUpperCase()}`, { b: true, sz: 20, cor: COR.cinza }),
        { antes: i ? 480 : 0, depois: 160, borda: true, junto: true }));
      if (!falas.length) out.push(par(run('(sem falas)', { cor: COR.cinza, sz: 28 })));
      falas.forEach(f => out.push(par(run(f, { sz: 36 }), { depois: 240, linha: 360 })));
    });
    return out.join('');
  }

  function documentXml(lista, ctx) {
    const corpo = [
      ctx.cliente ? par(run('Cliente: ', { b: true, sz: 26 }) + run(ctx.cliente, { sz: 26 }), { depois: 60 }) : '',
      ctx.mes ? par(run('Mês de gravação: ', { b: true, sz: 26 }) + run(ctx.mes, { sz: 26 }), { depois: 200 }) : '',
      par(run('QUEM FALA: ', { b: true }) + run('VERMELHO', { b: true, cor: COR.fala })),
      par(run('VIDEOMAKER: ', { b: true }) + run('ROXO', { b: true, cor: COR.video })),
      divisor(),
      ...lista.map((x, i) => blocoRoteiro(x, i + 1, i === 0)),
      teleprompter(lista, ctx),
    ].join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<w:body>${corpo}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  }

  const ARQS_FIXOS = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="pt-BR" w:eastAsia="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>',
  };

  // ---------- zip (sem compressão) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(arquivos) {
    const enc = new TextEncoder(); const partes = []; const central = []; let pos = 0;
    const d = new Date(); const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const [nome, conteudo] of Object.entries(arquivos)) {
      const n = enc.encode(nome), dados = enc.encode(conteudo), crc = crc32(dados);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, hora, true); h.setUint16(12, dia, true); h.setUint32(14, crc, true);
      h.setUint32(18, dados.length, true); h.setUint32(22, dados.length, true); h.setUint16(26, n.length, true); h.setUint16(28, 0, true);
      partes.push(new Uint8Array(h.buffer), n, dados);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, hora, true); c.setUint16(14, dia, true); c.setUint32(16, crc, true);
      c.setUint32(20, dados.length, true); c.setUint32(24, dados.length, true); c.setUint16(28, n.length, true);
      c.setUint32(42, pos, true);
      central.push(new Uint8Array(c.buffer), n);
      pos += 30 + n.length + dados.length;
    }
    const tamCentral = central.reduce((s, p) => s + p.length, 0);
    const fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, central.length / 2, true); fim.setUint16(10, central.length / 2, true);
    fim.setUint32(12, tamCentral, true); fim.setUint32(16, pos, true);
    return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  function gerar(lista, ctx = {}) {
    return zip({ ...ARQS_FIXOS, 'word/document.xml': documentXml(lista, ctx) });
  }

  function baixar(lista, ctx = {}) {
    const blob = gerar(lista, ctx);
    const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const nome = ['roteiros-gravacao', slug(ctx.cliente), ctx.mesArq || slug(ctx.mes)].filter(Boolean).join('-') + '.docx';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return nome;
  }

  window.RoteiroDocx = { gerar, baixar, montarTakes, itensDoRoteiro };
})();
