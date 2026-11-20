// Supabase Edge Function: atalho
// Porta de entrada dos Atalhos da Apple (iPhone e Apple Watch). Não usa login:
// cada pedido traz o "token do atalho", criado no sistema em Menu → Apple Watch e iPhone.
// O banco guarda só o hash (SHA-256) do token, nunca o token.
//
// Ações (POST com JSON):
//   { token }                                → menu do Modo Trabalho: { pergunta, opcoes[] }
//   { token, escolha: "<uma das opcoes>" }   → executa e devolve { mensagem }
//   { token, acao: "lancar", empresa, valor, cartao, tipo?, conta? } → lança no Financeiro
//
// Publicar: Supabase → Edge Functions → Deploy a new function → nome "atalho" → colar este arquivo.
// Depois, em Details, DESLIGUE "Enforce JWT Verification" (o Atalho não tem login; quem protege é o token).
import { createClient } from "npm:@supabase/supabase-js@2.50.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-atalho-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

// ---------- utilidades ----------
const TZ = "America/Sao_Paulo";
const hoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
const dias = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
const uid = (p = "") => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const brl = (v: number) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const minTxt = (s: number) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`; };
const curto = (s: string, n = 34) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
function parseValor(v: unknown) {
  if (typeof v === "number") return v;
  let s = String(v ?? "").replace(/[^\d,.-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

// ---------- acesso ao banco (mesmo formato do assets/core.js) ----------
type Rec = Record<string, any>;
async function lista(owner: string, col: string): Promise<Rec[]> {
  const { data, error } = await db.from("records").select("id,data").eq("owner", owner).eq("collection", col).neq("id", "__value");
  if (error) throw error;
  return (data || []).map((r) => r.data);
}
async function salvar(owner: string, col: string, obj: Rec) {
  const { error } = await db.from("records").upsert(
    { owner, collection: col, id: String(obj.id), data: obj, updated_at: new Date().toISOString() },
    { onConflict: "owner,collection,id" },
  );
  if (error) throw error;
}
// valores únicos: o site guarda { v: "<texto JSON>" }
async function lerValor(owner: string, col: string) {
  const { data } = await db.from("records").select("data").eq("owner", owner).eq("collection", col).eq("id", "__value").maybeSingle();
  if (!data) return null;
  try { return JSON.parse(data.data.v); } catch { return data.data.v; }
}
async function gravarValor(owner: string, col: string, valor: unknown) {
  const { error } = await db.from("records").upsert(
    { owner, collection: col, id: "__value", data: { v: JSON.stringify(valor) }, updated_at: new Date().toISOString() },
    { onConflict: "owner,collection,id" },
  );
  if (error) throw error;
}
async function dono(token: string) {
  if (!token || token.length < 20) return null;
  const alvo = JSON.stringify({ hash: await sha256(token) });
  const { data } = await db.from("records").select("owner").eq("collection", "atalho_token").eq("id", "__value").eq("data->>v", alvo).maybeSingle();
  return data?.owner || null;
}

// ---------- regras do Modo Trabalho (iguais às do index.html) ----------
const kind = (t: Rec) => t.kind || ({ crm_meeting: "reuniao", crm_follow: "follow", crm_evento: "evento" } as Rec)[t.notes] || "post";
const titulo = (t: Rec) => {
  let s = String(t.headline || t.title || t.client || "Sem título").replace(/^\[[^\]]+\]\s*/, "");
  const f = s.match(/^Follow Up: Follow \((.*)\)$/i);
  if (f) s = "Follow-up com " + f[1];
  return s;
};
function status(t: Rec) {
  if (t.status === "postado") return "postado";
  if (t.status === "aprovadas" || t.status === "approved") return "aprovadas";
  if (t.status === "pronto") return "pronto";
  if (t.isRejected) return "urgent";
  if (t.manuallyMovedToPronto) return t.status || "afazer";
  if (t.date) { const h = (Date.parse(t.date + "T23:59:59-03:00") - Date.now()) / 36e5; if (h <= 48) return "urgent"; }
  return t.status === "urgent" && !t.date ? "urgent" : "afazer";
}

type Item = { origem: string; ref: string; titulo: string; chave: string; score: number };

async function fila(owner: string, S: Rec | null): Promise<Item[]> {
  const t0 = hoje();
  const [tasks, casa] = await Promise.all([lista(owner, "tasks"), lista(owner, "life_casa")]);
  const empresa = tasks
    .filter((t) => kind(t) === "post" && !["pronto", "aprovadas", "postado"].includes(status(t)) && !t.feitoNoModoTrabalho)
    .map((t) => {
      const st = status(t), d = t.date ? dias(t0, t.date) : 99;
      let score = 20;
      if (t.isRejected) score = 100; else if (d < 0) score = 90; else if (d === 0) score = 85; else if (st === "urgent") score = 80; else if (d <= 3) score = 40;
      return { origem: "gestao", ref: String(t.id), titulo: titulo(t), chave: t.type || "Conteúdo", score };
    });
  const casaV = casa
    .map((c) => ({ ...c, atraso: c.ultimaVez ? dias(c.ultimaVez, t0) - c.freq : 999 }))
    .filter((c) => c.atraso >= 0 && c.ultimaVez !== t0)
    .map((c) => ({ origem: "casa", ref: String(c.id), titulo: c.nome, chave: c.nome, score: 45 + Math.min(c.atraso, 30) }));
  const avulsas = (S?.avulsas || []).map((a: Rec) => ({ origem: "avulsa", ref: String(a.ref), titulo: a.titulo, chave: a.chave || a.titulo, score: 70 }));
  const feitos = new Set((S?.itens || []).filter((i: Rec) => i.concluido).map((i: Rec) => i.origem + ":" + i.ref));
  return [...avulsas, ...empresa, ...casaV].filter((x) => !feitos.has(x.origem + ":" + x.ref)).sort((a, b) => b.score - a.score);
}

const segAtual = (S: Rec) => (S?.atual ? S.atual.acumulado + (S.atual.desde ? (Date.now() - S.atual.desde) / 1000 : 0) : 0);

type Opcao = { rotulo: string; fazer: string; item?: Item };
async function montarMenu(owner: string, S: Rec | null) {
  const f = await fila(owner, S);
  const a = S?.atual;
  const outras = f.filter((x) => !(a && x.origem === a.origem && x.ref === String(a.ref))).slice(0, 8);
  const usados = new Set<string>();
  const rot = (s: string) => { let r = s, n = 2; while (usados.has(r)) r = `${s} (${n++})`; usados.add(r); return r; };
  const ops: Opcao[] = [];
  let pergunta: string;
  if (!S) {
    pergunta = f.length ? "Modo trabalho: qual tarefa?" : "Nenhuma demanda aberta.";
    outras.forEach((x) => ops.push({ rotulo: rot("▶️ " + curto(x.titulo)), fazer: "iniciar", item: x }));
    ops.push({ rotulo: rot("🕒 Só iniciar o modo trabalho"), fazer: "abrir" });
  } else {
    const total = (Date.now() - S.inicio) / 1000;
    if (a) {
      pergunta = `${a.desde ? "Executando" : "Pausado"}: ${curto(a.titulo, 40)} · ${minTxt(segAtual(S))} (sessão ${minTxt(total)})`;
      ops.push({ rotulo: rot("✅ Concluir"), fazer: "concluir" });
      ops.push({ rotulo: rot(a.desde ? "⏸️ Pausar" : "▶️ Retomar"), fazer: "pausar" });
    } else pergunta = `Modo trabalho · ${minTxt(total)}. Próxima tarefa?`;
    outras.forEach((x) => ops.push({ rotulo: rot((a ? "🔁 " : "▶️ ") + curto(x.titulo)), fazer: "iniciar", item: x }));
    ops.push({ rotulo: rot("⏹️ Fim do trabalho"), fazer: "fim" });
  }
  return { pergunta, ops };
}

function pausarParaFila(S: Rec) {
  const a = S.atual; if (!a) return;
  S.itens.push({ origem: a.origem, ref: a.ref, titulo: a.titulo, chave: a.chave, segundos: segAtual(S), concluido: false });
  S.atual = null;
}

async function concluir(owner: string, S: Rec) {
  const a = S.atual; if (!a) return "Nenhuma tarefa em andamento.";
  const parciais = S.itens.filter((i: Rec) => !i.concluido && i.origem === a.origem && String(i.ref) === String(a.ref));
  const total = segAtual(S) + parciais.reduce((s: number, i: Rec) => s + i.segundos, 0);
  S.itens = S.itens.filter((i: Rec) => !parciais.includes(i));
  S.itens.push({ origem: a.origem, ref: a.ref, titulo: a.titulo, chave: a.chave, segundos: total, concluido: true, fim: Date.now() });
  S.atual = null;
  if (a.origem === "casa") {
    const c = (await lista(owner, "life_casa")).find((x) => String(x.id) === String(a.ref));
    if (c) { c.ultimaVez = hoje(); await salvar(owner, "life_casa", c); }
  }
  if (a.origem === "gestao") {
    const t = (await lista(owner, "tasks")).find((x) => String(x.id) === String(a.ref));
    if (t) {
      t.tempoGasto = (t.tempoGasto || 0) + total;
      t.feitoNoModoTrabalho = hoje();
      if (!["pronto", "aprovadas"].includes(t.status)) { t.status = "pronto"; t.manuallyMovedToPronto = true; }
      if (t.isRejected) { t.isRejected = false; t.ajusteFeitoEm = hoje(); }
      await salvar(owner, "tasks", t);
    }
  }
  return `✅ ${a.titulo}: ${minTxt(total)}`;
}

async function executar(owner: string, escolha: string) {
  let S = await lerValor(owner, "life_sessao_ativa");
  if (S && (!S.inicio || !Array.isArray(S.itens))) S = null;
  const { ops } = await montarMenu(owner, S);
  const op = ops.find((o) => o.rotulo === escolha.trim());
  if (!op) return "A lista mudou. Abra o atalho de novo.";
  let msg = "";
  if (op.fazer === "abrir" || (op.fazer === "iniciar" && !S)) {
    S = { id: uid("ss_"), inicio: Date.now(), itens: [], atual: null, avulsas: [], origem: "relogio" };
    msg = "🕒 Modo trabalho iniciado.";
  }
  if (op.fazer === "iniciar" && op.item) {
    if (S!.atual) pausarParaFila(S!);
    const x = op.item;
    S!.atual = { origem: x.origem, ref: x.ref, titulo: x.titulo, chave: x.chave, acumulado: 0, desde: Date.now() };
    msg = (msg ? msg + " " : "") + `▶️ ${x.titulo}`;
  } else if (op.fazer === "pausar") {
    const a = S!.atual;
    if (a.desde) { a.acumulado += (Date.now() - a.desde) / 1000; a.desde = null; msg = `⏸️ Pausado: ${a.titulo}`; }
    else { a.desde = Date.now(); msg = `▶️ Retomado: ${a.titulo}`; }
  } else if (op.fazer === "concluir") {
    msg = await concluir(owner, S!);
  } else if (op.fazer === "fim") {
    if (S!.atual) pausarParaFila(S!);
    const fim = Date.now();
    const sess = {
      id: S!.id, inicio: new Date(S!.inicio).toISOString(), fim: new Date(fim).toISOString(),
      data: new Date(S!.inicio).toLocaleDateString("sv-SE", { timeZone: TZ }), duracaoTotal: (fim - S!.inicio) / 1000, itens: S!.itens,
    };
    await salvar(owner, "life_sessoes", sess);
    await gravarValor(owner, "life_sessao_ativa", null);
    return `⏹️ Sessão salva: ${minTxt(sess.duracaoTotal)} · ${sess.itens.filter((i: Rec) => i.concluido).length} concluída(s)`;
  }
  await gravarValor(owner, "life_sessao_ativa", S);
  return msg;
}

// ---------- Financeiro (Apple Pay) ----------
async function lancar(owner: string, b: Rec) {
  const valor = parseValor(b.valor);
  const empresa = String(b.empresa || b.comerciante || "").trim() || "Apple Pay";
  if (!valor) return { ok: false, mensagem: "Valor não veio no atalho." };
  let categoria = String(b.categoria || "").trim();
  if (!categoria) {
    const ant = (await lista(owner, "fin_lancamentos"))
      .filter((l) => l.categoria && String(l.empresa || l.descricao || "").toLowerCase() === empresa.toLowerCase())
      .sort((x, y) => String(y.criadoEm || y.data).localeCompare(String(x.criadoEm || x.data)))[0];
    categoria = ant?.categoria || "";
  }
  const item = {
    id: uid("fl_"), tipo: b.tipo === "entrada" ? "entrada" : "saida", descricao: empresa, empresa, valor,
    data: /^\d{4}-\d{2}-\d{2}$/.test(b.data || "") ? b.data : hoje(), categoria,
    conta: b.conta === "Empresa" ? "Empresa" : "Pessoal", forma: String(b.cartao || b.forma || "").trim(),
    status: "pago", origem: "iphone", criadoEm: new Date().toISOString(),
  };
  await salvar(owner, "fin_lancamentos", item);
  return { ok: true, id: item.id, mensagem: `Lançado: ${empresa} · ${brl(valor)}${categoria ? " · " + categoria : " · sem categoria"}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const q = new URL(req.url).searchParams;
    let b: Rec = {};
    if (req.method === "POST") { try { b = await req.json(); } catch { b = {}; } }
    // O token vem só no corpo JSON ou no cabeçalho x-atalho-token. Na URL (?token=) ele
    // ficaria gravado em logs e no histórico, por isso não é aceito.
    const token = String(b.token || req.headers.get("x-atalho-token") || "");
    const owner = await dono(token);
    if (!owner) return json({ erro: "Token inválido. Gere um novo no sistema: Menu → Apple Watch e iPhone.", mensagem: "Token inválido.", opcoes: ["OK"] }, 401);

    if ((b.acao || q.get("acao")) === "lancar") return json(await lancar(owner, { ...Object.fromEntries(q), ...b }));

    if (b.escolha) return json({ mensagem: await executar(owner, String(b.escolha)) });

    let S = await lerValor(owner, "life_sessao_ativa");
    if (S && (!S.inicio || !Array.isArray(S.itens))) S = null;
    const { pergunta, ops } = await montarMenu(owner, S);
    return json({ pergunta, opcoes: ops.map((o) => o.rotulo) });
  } catch (e) {
    console.error(e);
    return json({ erro: String((e as Error).message || e), mensagem: "Erro no servidor." }, 500);
  }
});
