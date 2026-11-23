// Supabase Edge Function: instagram-metricas
// Puxa as métricas do Instagram de cada cliente conectado (tabela ig_contas) e guarda em
// ig_metricas_dia (conta, por dia) e ig_metricas_posts (cada post dos últimos 30 dias).
//
// Chamadas:
//   { modo: "cron" }                -> pg_cron, todo dia às 6h (Brasília): todas as contas, ontem e anteontem.
//   { modo: "agora", cliente?, dias? } -> (logado) atualiza agora; "dias" (até 30) preenche o histórico.
//
// Publicar: Supabase > Edge Functions > instagram-metricas, com "Verify JWT" DESLIGADO
// (o cron não manda login; a função só lê a Meta e grava números, nunca devolve dados sem login).
// Segredo: META_IG_TOKEN (o mesmo da publicação).
import { createClient } from "npm:@supabase/supabase-js@2.50.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

function chaveServico(): string {
  const legado = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legado) return legado;
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return k.default || Object.values(k)[0] as string; }
  catch { return ""; }
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, chaveServico(), { auth: { persistSession: false } });
const TOKEN = (Deno.env.get("META_IG_TOKEN") ?? "").trim().replace(/^.*META_IG_TOKEN\s*=\s*/i, "").replace(/^["']+|["']+$/g, "").replace(/\s+/g, "");
const GRAPH = TOKEN.startsWith("IG") ? "https://graph.instagram.com/v23.0" : "https://graph.facebook.com/v23.0";

const METRICAS_CONTA = ["reach", "views", "accounts_engaged", "total_interactions", "likes", "comments", "shares", "saves", "profile_links_taps", "follows_and_unfollows"];
const METRICAS_POST = ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions"];

async function graph(path: string, params: Record<string, string> = {}) {
  const r = await fetch(`${GRAPH}/${path}?${new URLSearchParams({ ...params, access_token: TOKEN })}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.error_user_msg || j.error?.message || `Instagram respondeu ${r.status}`);
  return j;
}

const diaUTC = (d: Date) => d.toISOString().slice(0, 10);
// dia no fuso de Brasília (UTC-3, sem horário de verão)
const diaBR = (offset: number) => { const d = new Date(Date.now() - 3 * 3600e3); d.setUTCDate(d.getUTCDate() - offset); return diaUTC(d); };

async function insightsDoDia(igId: string, dia: string) {
  const since = Math.floor(new Date(dia + "T03:00:00Z").getTime() / 1000);   // 00h de Brasília
  const until = since + 86400;
  const dados: Record<string, number> = {};
  // pede tudo de uma vez; se a Meta recusar alguma métrica, pede uma por uma
  const ler = (r: any) => (r.data || []).forEach((m: any) => { if (m.total_value?.value != null) dados[m.name] = m.total_value.value; });
  try {
    ler(await graph(`${igId}/insights`, { metric: METRICAS_CONTA.join(","), period: "day", metric_type: "total_value", since: String(since), until: String(until) }));
  } catch {
    for (const m of METRICAS_CONTA) {
      try { ler(await graph(`${igId}/insights`, { metric: m, period: "day", metric_type: "total_value", since: String(since), until: String(until) })); } catch { /* métrica indisponível */ }
    }
  }
  return dados;
}

async function postsRecentes(owner: string, igId: string) {
  const r = await graph(`${igId}/media`, { fields: "id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count", limit: "40" });
  const limite = Date.now() - 30 * 86400e3;
  const posts = (r.data || []).filter((m: any) => new Date(m.timestamp).getTime() >= limite);
  const linhas = [];
  for (const m of posts) {
    const dados: Record<string, number> = { likes: m.like_count ?? 0, comments: m.comments_count ?? 0 };
    try {
      const ins = await graph(`${m.id}/insights`, { metric: METRICAS_POST.join(",") });
      (ins.data || []).forEach((x: any) => { const v = x.values?.[0]?.value ?? x.total_value?.value; if (v != null) dados[x.name] = v; });
    } catch { /* post sem insights (ex.: antigo ou de colaboração) */ }
    linhas.push({
      owner, ig_id: igId, media_id: m.id, publicado: m.timestamp,
      tipo: m.media_product_type === "REELS" ? "Reels" : m.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : m.media_type === "VIDEO" ? "Vídeo" : "Foto",
      legenda: String(m.caption || "").slice(0, 500), link: m.permalink,
      capa: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url,
      dados, atualizado: new Date().toISOString(),
    });
  }
  if (linhas.length) {
    const { error } = await db.from("ig_metricas_posts").upsert(linhas, { onConflict: "owner,media_id" });
    if (error) throw new Error(error.message);
  }
  return linhas.length;
}

async function atualizarConta(c: { owner: string; ig_id: string; cliente_nome: string }, dias: number) {
  const info = await graph(c.ig_id, { fields: "followers_count,media_count,username" });
  const linhas = [];
  for (let i = 1; i <= dias; i++) {
    const dia = diaBR(i);
    linhas.push({ owner: c.owner, ig_id: c.ig_id, dia, dados: await insightsDoDia(c.ig_id, dia), atualizado: new Date().toISOString() });
  }
  // seguidores é uma foto do momento: vale para hoje
  linhas.push({ owner: c.owner, ig_id: c.ig_id, dia: diaBR(0), seguidores: info.followers_count ?? null, dados: { publicacoes: info.media_count ?? null }, atualizado: new Date().toISOString() });
  for (const l of linhas) {
    // não apaga o número de seguidores já gravado de um dia anterior
    const { data: atual } = await db.from("ig_metricas_dia").select("seguidores,dados").eq("owner", l.owner).eq("ig_id", l.ig_id).eq("dia", l.dia).maybeSingle();
    const novo = { ...l, seguidores: (l as any).seguidores ?? atual?.seguidores ?? null, dados: { ...(atual?.dados || {}), ...l.dados } };
    const { error } = await db.from("ig_metricas_dia").upsert(novo, { onConflict: "owner,ig_id,dia" });
    if (error) throw new Error(error.message);
  }
  const posts = await postsRecentes(c.owner, c.ig_id);
  return `@${info.username}: ${dias} dia(s), ${posts} post(s)`;
}

async function rodar(owner?: string, cliente?: string, dias = 2) {
  if (!TOKEN) throw new Error("Falta o segredo META_IG_TOKEN nas Edge Functions.");
  let q = db.from("ig_contas").select("owner,ig_id,cliente,cliente_nome");
  if (owner) q = q.eq("owner", owner);
  if (cliente) q = q.eq("cliente", cliente);
  const { data: contas, error } = await q;
  if (error) throw new Error(error.message);
  const log: string[] = [];
  for (const c of contas || []) {
    if (!owner) {   // chamada sem login (cron): no máximo uma atualização a cada 6 h por conta
      const { data: hoje } = await db.from("ig_metricas_dia").select("atualizado").eq("owner", c.owner).eq("ig_id", c.ig_id).eq("dia", diaBR(0)).maybeSingle();
      if (hoje && Date.now() - new Date(hoje.atualizado).getTime() < 6 * 3600e3) { log.push(`${c.cliente_nome}: já atualizado hoje`); continue; }
    }
    try { log.push(`${c.cliente_nome}: ${await atualizarConta(c, dias)}`); }
    catch (e) { log.push(`${c.cliente_nome}: erro: ${(e as Error).message}`); }
  }
  return log;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    if ((body.modo || "cron") === "cron") return json({ ok: true, log: await rodar() });
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
    if (!data?.user) return json({ erro: "Faça login no Dashplasso." }, 401);
    const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    const dias = Math.max(1, Math.min(30, Number(body.dias) || 2));
    return json({ ok: true, log: await rodar(data.user.id, body.cliente ? norm(body.cliente) : undefined, dias) });
  } catch (e) {
    return json({ erro: String((e as Error).message || e) }, 500);
  }
});
