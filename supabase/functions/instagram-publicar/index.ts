// Supabase Edge Function: instagram-publicar
// Publica no Instagram pela API oficial (Instagram API com login unificado).
// O token fica no segredo META_IG_TOKEN (Edge Functions > Secrets). Nunca no site.
//
// Modos (body JSON):
//   { modo: "cron" }                      -> chamado pelo pg_cron a cada 5 min: publica o que já está na hora.
//   { modo: "verificar" }                 -> (logado) confere o token e devolve a conta do Instagram.
//   { modo: "upload", nome }              -> (logado) devolve um link temporário para enviar um arquivo ao bucket "postagens".
//   { modo: "agora" }                     -> (logado) roda a fila na hora (mesmo processo do cron).
//   { modo: "conferir", id }             -> (logado) confere token, conta, cliente e arquivo de um agendamento, sem publicar.
//   { modo: "testar", caminho, igId }     -> (logado) manda um reel pro Instagram processar, sem publicar.
//   { modo: "contas" }                    -> (logado) contas que o token alcança, validade do token e clientes ligados.
//   { modo: "conectar", cliente, igId }   -> (logado) liga a conta do Instagram ao cliente (tabela ig_contas).
//   { modo: "desconectar", cliente }      -> (logado) desliga.
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

// TRAVA DE SEGURANÇA: cada conteúdo só é publicado na conta do Instagram ligada ao cliente dele
// (tabela ig_contas, conectada pela tela Instagram do Dashplasso com o modo "conectar").
const normCliente = (c: unknown) => String(c ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

async function contaDoCliente(owner: string, taskId: string | null): Promise<string> {
  if (!taskId) throw new Error("Agendamento sem conteúdo vinculado: por segurança, não publico.");
  const { data } = await db.from("records").select("data").eq("owner", owner).eq("collection", "tasks").eq("id", taskId).maybeSingle();
  const cliente = data?.data?.client;
  const { data: c } = await db.from("ig_contas").select("ig_id").eq("owner", owner).eq("cliente", normCliente(cliente)).maybeSingle();
  if (!c?.ig_id) throw new Error(`O cliente "${cliente || "sem cliente"}" não tem conta do Instagram conectada. Nada foi publicado.`);
  return String(c.ig_id);
}

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

async function contasAlcancadas() {
  const out: { igId: string; username: string; nome: string; pagina: string }[] = [];
  let next = "me/accounts";
  let params: Record<string, string> = { fields: "name,instagram_business_account{id,username,name}", limit: "100" };
  for (let i = 0; i < 10 && next; i++) {
    const r = await graph(next, params);
    for (const p of r.data || []) {
      const ig = p.instagram_business_account;
      if (ig?.id) out.push({ igId: String(ig.id), username: ig.username || "", nome: ig.name || "", pagina: p.name || "" });
    }
    const n = r.paging?.next as string | undefined;
    if (!n) break;
    const u = new URL(n);
    next = u.pathname.replace(/^\/v[\d.]+\//, "");
    params = Object.fromEntries([...u.searchParams].filter(([k]) => k !== "access_token"));
  }
  // contas do Instagram atribuídas pelo Business Manager (próprias e de clientes parceiros)
  try {
    const bms = (await graph("me/businesses", { fields: "id,name", limit: "50" })).data || [];
    for (const bm of bms) {
      for (const aresta of ["owned_instagram_accounts", "client_instagram_accounts"]) {
        try {
          const r = await graph(`${bm.id}/${aresta}`, { fields: "id,username,name", limit: "100" });
          for (const ig of r.data || []) if (!out.some((o) => o.igId === String(ig.id))) out.push({ igId: String(ig.id), username: ig.username || "", nome: ig.name || "", pagina: bm.name || "" });
        } catch { /* sem acesso a essa lista */ }
      }
    }
  } catch { /* token sem business_management */ }
  return out;
}

const PERMISSOES = ["instagram_basic", "instagram_content_publish", "instagram_manage_insights", "pages_show_list", "pages_read_engagement", "business_management"];
async function validadeToken() {
  const out: Record<string, unknown> = {};
  try { const me = await graph("me", { fields: "id,name" }); out.quem = me.name || me.id; } catch (e) { out.quem = ""; }
  try {
    const p = (await graph("me/permissions")).data || [];
    const ok = p.filter((x: any) => x.status === "granted").map((x: any) => x.permission);
    out.escopos = ok; out.faltam = PERMISSOES.filter((x) => !ok.includes(x));
  } catch { out.faltam = null; }   // token de Página não lista permissões
  try {
    const d = (await graph("debug_token", { input_token: TOKEN })).data || {};
    out.expira = d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null; out.nuncaExpira = d.expires_at === 0; out.tipo = d.type || "";
  } catch { /* só o dono do app consegue ver a validade */ }
  return out;
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
  const log: string[] = [];
  for (const a of fila as Ag[]) {
    // trava de 4 minutos para duas execuções não publicarem o mesmo post
    const ate = new Date(Date.now() + 4 * 60 * 1000).toISOString();
    const { data: ok } = await db.from("ig_agendamentos").update({ trava_ate: ate })
      .eq("id", a.id).or(`trava_ate.is.null,trava_ate.lt.${agora}`).select("id");
    if (!ok?.length) { log.push(`${a.id}: já em andamento`); continue; }
    try {
      const igId = await contaDoCliente(a.owner, a.task_id); // trava: só publica na conta do próprio cliente
      if (a.status === "agendado") { // trava: o mesmo conteúdo não é publicado duas vezes
        const { data: ja } = await db.from("ig_agendamentos").select("permalink").eq("task_id", a.task_id).eq("status", "publicado").neq("id", a.id).limit(1);
        if (ja?.length) throw new Error(`Esse conteúdo já foi publicado${ja[0].permalink ? " em " + ja[0].permalink : ""}. Não publiquei de novo.`);
      }
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
    if (modo === "contas") {
      // contas do Instagram que o token alcança + quais já estão ligadas a clientes
      const [alcancadas, token, ligadas] = await Promise.all([
        contasAlcancadas().catch((e) => { throw new Error(`Não consegui listar as contas: ${(e as Error).message}`); }),
        validadeToken(),
        db.from("ig_contas").select("cliente,cliente_nome,ig_id,username,conectado_em").eq("owner", user.id),
      ]);
      return json({ ok: true, alcancadas, token, ligadas: ligadas.data || [] });
    }
    if (modo === "conectar") {
      const igId = String(body.igId || "");
      const nome = String(body.cliente || "").trim().slice(0, 120);
      if (!igId || !nome) return json({ erro: "Informe o cliente e a conta." }, 400);
      const conta = (await contasAlcancadas()).find((c) => c.igId === igId);
      if (!conta) return json({ erro: "Essa conta não está entre as que o token alcança." }, 400);
      const { data: outra } = await db.from("ig_contas").select("cliente_nome").eq("owner", user.id).eq("ig_id", igId).neq("cliente", normCliente(nome)).maybeSingle();
      if (outra) return json({ erro: `Essa conta já está ligada a ${outra.cliente_nome}.` }, 400);
      const { error } = await db.from("ig_contas").upsert({ owner: user.id, cliente: normCliente(nome), cliente_nome: nome, ig_id: igId, username: conta.username, conectado_em: new Date().toISOString() }, { onConflict: "owner,cliente" });
      if (error) throw new Error(error.message);
      return json({ ok: true, username: conta.username });
    }
    if (modo === "desconectar") {
      await db.from("ig_contas").delete().eq("owner", user.id).eq("cliente", normCliente(body.cliente));
      return json({ ok: true });
    }
    if (modo === "conferir") {
      // confere tudo o que a publicação vai precisar, SEM publicar
      const itens: { ok: boolean; texto: string }[] = [];
      const add = (ok: boolean, texto: string) => itens.push({ ok, texto });
      const { data: a } = await db.from("ig_agendamentos").select("*").eq("id", String(body.id)).eq("owner", user.id).maybeSingle();
      if (!a) return json({ ok: false, itens: [{ ok: false, texto: "Agendamento não encontrado." }] });
      add(a.status === "agendado" || a.status === "processando" || a.status === "publicado", `Situação: ${a.status}${a.erro ? " (" + a.erro + ")" : ""}`);
      const quando = new Date(a.publicar_em);
      add(a.status === "publicado" || quando.getTime() > Date.now() - 10 * 60 * 1000, `Horário: ${quando.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
      try {
        const igId = await contaDoCliente(a.owner, a.task_id);
        const c = await graph(igId, { fields: "username" });
        add(true, `Publica em @${c.username} (conta do cliente deste conteúdo)`);
      } catch (e) { add(false, (e as Error).message); }
      for (const m of a.midias as string[]) {
        try {
          const url = await linkLeitura(m);
          const r = await fetch(url, { method: "HEAD" });
          const mb = Number(r.headers.get("content-length") || 0) / 1048576;
          add(r.ok, r.ok ? `Arquivo no Storage (${mb.toFixed(1)} MB)` : `Arquivo inacessível (${r.status})`);
        } catch (e) { add(false, (e as Error).message); }
      }
      add(true, "O Dashplasso confere a fila a cada 5 minutos");
      return json({ ok: itens.every((i) => i.ok), status: a.status, permalink: a.permalink, itens });
    }
    if (modo === "testar") {
      // cria o contêiner do reel e espera o Instagram processar, SEM publicar (o contêiner expira sozinho em 24 h)
      const igId = String(body.igId || IG_ID_PADRAO);
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
