// Supabase Edge Function: instagram-publicar
// Publica no Instagram pela API oficial (Instagram API com login unificado).
// O token fica no segredo META_IG_TOKEN (Edge Functions > Secrets). Nunca no site.
//
// Modos (body JSON):
//   { modo: "cron" }                      -> chamado pelo pg_cron a cada 5 min: publica o que já está na hora.
//   { modo: "verificar" }                 -> (logado) confere o token e devolve a conta do Instagram.
//   { modo: "upload", nome }              -> (logado) devolve um link temporário para enviar um arquivo ao bucket "postagens".
//   { modo: "agora" }                     -> (logado) roda a fila na hora (mesmo processo do cron).
//   { modo: "testar", caminho }           -> (logado) manda um reel pro Instagram processar, sem publicar.
// Nesta função o "Verify JWT" fica DESLIGADO (o cron chama sem login);
// os modos que mexem em arquivos ou na conta conferem o login aqui dentro.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Token do login do Instagram começa com "IG" (graph.instagram.com);
// token do Facebook / usuário do sistema começa com "EA" (graph.facebook.com).
const TOKEN = (Deno.env.get("META_IG_TOKEN") ?? "").trim().replace(/^.*META_IG_TOKEN\s*=\s*/i, "").replace(/^["']+|["']+$/g, "").replace(/\s+/g, "");
const TIPO_TOKEN = TOKEN.startsWith("IG") ? "instagram" : "facebook";
const GRAPH = TIPO_TOKEN === "instagram" ? "https://graph.instagram.com/v23.0" : "https://graph.facebook.com/v23.0";
const IG_ID_PADRAO = Deno.env.get("META_IG_USER_ID") || "17841454339423114"; // @marcelohbuzeli
function chaveServico(): string {
  const legado = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legado) return legado;
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return k.default || Object.values(k)[0] as string; }
  catch { return ""; }
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, chaveServico(), {
  auth: { persistSession: false },
});
const BUCKET = "postagens";

async function graph(path: string, params: Record<string, string> = {}, method: "GET" | "POST" = "GET") {
  const p = new URLSearchParams({ ...params, access_token: TOKEN });
  const r = method === "GET"
    ? await fetch(`${GRAPH}/${path}?${p}`)
    : await fetch(`${GRAPH}/${path}`, { method: "POST", body: p });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.error_user_msg || j.error?.message || `Instagram respondeu ${r.status}`);
  return j;
}

async function conta() {
  if (TIPO_TOKEN === "instagram") {
    const me = await graph("me", { fields: "user_id,username" });
    return { igId: String(me.user_id || me.id), username: me.username as string, tipoToken: TIPO_TOKEN };
  }
  try {
    const pags = await graph("me/accounts", { fields: "instagram_business_account{id,username}" });
    const ig = (pags.data || []).map((p: any) => p.instagram_business_account).find(Boolean);
    if (ig?.id) return { igId: String(ig.id), username: ig.username as string, tipoToken: TIPO_TOKEN };
  } catch { /* usuário do sistema pode não listar páginas; tenta o id direto */ }
  const ig = await graph(IG_ID_PADRAO, { fields: "id,username" });
  return { igId: String(ig.id), username: ig.username as string, tipoToken: TIPO_TOKEN };
}

async function usuario(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  return data?.user ?? null;
}

async function linkLeitura(caminho: string) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(caminho, 3 * 3600);
  if (error || !data?.signedUrl) throw new Error(`Não achei o arquivo ${caminho} no Storage.`);
  return data.signedUrl;
}

const ehVideo = (c: string) => /\.(mp4|mov)$/i.test(c);

async function marcarTarefa(owner: string, taskId: string | null, campos: Record<string, unknown>) {
  if (!taskId) return;
  const { data } = await db.from("records").select("data").eq("owner", owner).eq("collection", "tasks").eq("id", taskId).maybeSingle();
  if (!data) return;
  await db.from("records").update({ data: { ...data.data, ...campos }, updated_at: new Date().toISOString() })
    .eq("owner", owner).eq("collection", "tasks").eq("id", taskId);
}

type Ag = {
  id: string; owner: string; task_id: string | null; tipo: "REELS" | "IMAGE" | "CAROUSEL"; legenda: string;
  midias: string[]; status: string; containers: string[] | null; container_id: string | null; tentativas: number;
};

async function salvar(id: string, campos: Record<string, unknown>) {
  await db.from("ig_agendamentos").update({ ...campos, updated_at: new Date().toISOString() }).eq("id", id);
}

async function passo(a: Ag, igId: string): Promise<string> {
  // 1) criar os contêineres
  if (a.status === "agendado") {
    if (a.tipo === "REELS") {
      const c = await graph(`${igId}/media`, {
        media_type: "REELS", video_url: await linkLeitura(a.midias[0]), caption: a.legenda, share_to_feed: "true",
      }, "POST");
      await salvar(a.id, { status: "processando", container_id: c.id });
      return "contêiner do reel criado";
    }
    if (a.tipo === "IMAGE") {
      const c = await graph(`${igId}/media`, { image_url: await linkLeitura(a.midias[0]), caption: a.legenda }, "POST");
      await salvar(a.id, { status: "processando", container_id: c.id });
      return "contêiner da imagem criado";
    }
    const filhos: string[] = [];
    for (const m of a.midias.slice(0, 10)) {
      const url = await linkLeitura(m);
      const c = await graph(`${igId}/media`, ehVideo(m)
        ? { media_type: "VIDEO", video_url: url, is_carousel_item: "true" }
        : { image_url: url, is_carousel_item: "true" }, "POST");
      filhos.push(c.id);
    }
    await salvar(a.id, { status: "processando", containers: filhos });
    return `carrossel: ${filhos.length} itens enviados`;
  }

  // 2) carrossel: criar o contêiner principal quando todos os itens estiverem prontos
  if (a.tipo === "CAROUSEL" && !a.container_id) {
    for (const f of a.containers ?? []) {
      const s = await graph(f, { fields: "status_code" });
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Um item do carrossel falhou (${s.status_code}).`);
      if (s.status_code !== "FINISHED") { await salvar(a.id, { tentativas: a.tentativas + 1 }); return "itens ainda processando"; }
    }
    const c = await graph(`${igId}/media`, { media_type: "CAROUSEL", children: (a.containers ?? []).join(","), caption: a.legenda }, "POST");
    await salvar(a.id, { container_id: c.id });
    a.container_id = c.id;
  }

  // 3) publicar quando o Instagram terminar de processar
  const s = await graph(a.container_id!, { fields: "status_code,status" });
  if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`O Instagram não processou a mídia: ${s.status || s.status_code}`);
  if (s.status_code !== "FINISHED") {
    if (a.tentativas >= 30) throw new Error("O Instagram demorou demais para processar o vídeo.");
    await salvar(a.id, { tentativas: a.tentativas + 1 });
    return `ainda processando (${s.status_code})`;
  }
  const pub = await graph(`${igId}/media_publish`, { creation_id: a.container_id! }, "POST");
  let permalink = "";
  try { permalink = (await graph(pub.id, { fields: "permalink" })).permalink || ""; } catch { /* sem link, segue */ }
  await salvar(a.id, { status: "publicado", media_id: pub.id, permalink, erro: null });
  await marcarTarefa(a.owner, a.task_id, { status: "postado", fase: "Postado", linkPost: permalink });
  return `publicado ${permalink}`;
}

async function rodarFila(owner?: string) {
  if (!TOKEN) throw new Error("Falta o segredo META_IG_TOKEN nas Edge Functions.");
  const agora = new Date().toISOString();
  let q = db.from("ig_agendamentos").select("*")
    .in("status", ["agendado", "processando"]).lte("publicar_em", agora).order("publicar_em").limit(10);
  if (owner) q = q.eq("owner", owner);
  const { data: fila, error } = await q;
  if (error) throw new Error(error.message);
  if (!fila?.length) return [];
  const { igId } = await conta();
  const log: string[] = [];
  for (const a of fila as Ag[]) {
    // trava de 4 minutos para duas execuções não publicarem o mesmo post
    const ate = new Date(Date.now() + 4 * 60 * 1000).toISOString();
    const { data: ok } = await db.from("ig_agendamentos").update({ trava_ate: ate })
      .eq("id", a.id).or(`trava_ate.is.null,trava_ate.lt.${agora}`).select("id");
    if (!ok?.length) { log.push(`${a.id}: já em andamento`); continue; }
    try {
      log.push(`${a.id}: ${await passo(a, igId)}`);
    } catch (e) {
      const msg = String((e as Error).message || e);
      await salvar(a.id, { status: "erro", erro: msg });
      await marcarTarefa(a.owner, a.task_id, { fase: "Falhou" });
      log.push(`${a.id}: erro: ${msg}`);
    } finally {
      await db.from("ig_agendamentos").update({ trava_ate: null }).eq("id", a.id);
    }
  }
  return log;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const modo = body.modo || "cron";
    if (modo === "cron") return json({ ok: true, log: await rodarFila() });

    const user = await usuario(req);
    if (!user) return json({ erro: "Faça login no Dashplasso." }, 401);

    if (modo === "verificar") {
      try { return json({ ok: true, ...(await conta()) }); }
      catch (e) { return json({ ok: false, erro: String((e as Error).message || e), tipoToken: TIPO_TOKEN, tamanhoToken: TOKEN.length, formato: { comecaIGAA: /^IGAA/i.test(TOKEN), comecaEAA: /^EAA/.test(TOKEN), temIgual: TOKEN.includes("="), temDoisPontos: TOKEN.includes(":"), soLetrasENumeros: /^[A-Za-z0-9]+$/.test(TOKEN), temNomeDoSegredo: /META_IG_TOKEN/i.test(TOKEN) } }); }
    }
    if (modo === "agora") return json({ ok: true, log: await rodarFila(user.id) });
    if (modo === "testar") {
      // cria o contêiner do reel e espera o Instagram processar, SEM publicar (o contêiner expira sozinho em 24 h)
      const { igId } = await conta();
      const c = await graph(`${igId}/media`, { media_type: "REELS", video_url: await linkLeitura(String(body.caminho)), caption: "teste" }, "POST");
      let st: any = {};
      for (let i = 0; i < 10; i++) { await new Promise((r) => setTimeout(r, 5000)); st = await graph(c.id, { fields: "status_code,status" }); if (st.status_code !== "IN_PROGRESS") break; }
      return json({ ok: true, container: c.id, status_code: st.status_code, status: st.status });
    }
    if (modo === "upload") {
      const nome = String(body.nome || "arquivo").normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
      const caminho = `${user.id}/${Date.now()}-${nome}`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(caminho);
      if (error) throw new Error(error.message);
      return json({ ok: true, caminho, url: data.signedUrl });
    }
    return json({ erro: "modo desconhecido" }, 400);
  } catch (e) {
    return json({ erro: String((e as Error).message || e) }, 500);
  }
});
