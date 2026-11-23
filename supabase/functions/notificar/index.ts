// Supabase Edge Function: notificar
// Manda o push para o celular do Marcelo quando um cliente aprova ou pede ajuste no portal.
//
// Chamadas:
//   GET  ?chave=1   -> devolve a chave pública VAPID (o site usa para ativar o push no aparelho).
//                      Na 1ª vez cria o par de chaves e guarda em push_config (só a chave de serviço lê).
//   POST { id }     -> gatilho do banco (notificacoes_push): envia a notificação "id" para todos os
//                      aparelhos do dono, uma única vez (enviada_em), e remove inscrições vencidas.
//   POST { teste: true } com login -> manda uma notificação de teste para os aparelhos de quem chamou.
//
// Publicar: Supabase > Edge Functions > notificar, com "Verify JWT" DESLIGADO
// (o gatilho do banco não manda login; a função nunca devolve dados, só envia o push uma vez por notificação).
// Não precisa de segredo: as chaves VAPID ficam no banco.
import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

function chaveServico(): string {
  const legado = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legado) return legado;
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return k.default || Object.values(k)[0] as string; }
  catch { return ""; }
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, chaveServico(), { auth: { persistSession: false } });
const SITE = "https://marcelohbuzeli.github.io/Dashplasso/";

async function chaves() {
  const { data } = await db.from("push_config").select("vapid_pub,vapid_priv").eq("id", 1).maybeSingle();
  if (data) return data;
  const k = webpush.generateVAPIDKeys();
  await db.from("push_config").upsert({ id: 1, vapid_pub: k.publicKey, vapid_priv: k.privateKey }, { onConflict: "id", ignoreDuplicates: true });
  const { data: salvo } = await db.from("push_config").select("vapid_pub,vapid_priv").eq("id", 1).single();
  return salvo!;
}

async function enviar(owner: string, payload: Record<string, unknown>) {
  const k = await chaves();
  webpush.setVapidDetails("https://marcelohbuzeli.github.io", k.vapid_pub, k.vapid_priv);
  const { data: subs } = await db.from("push_inscricoes").select("endpoint,p256dh,auth").eq("owner", owner);
  let ok = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 86400, urgency: "high" });
      ok++;
    } catch (e) {
      const st = (e as { statusCode?: number }).statusCode;
      if (st === 404 || st === 410) await db.from("push_inscricoes").delete().eq("endpoint", s.endpoint); // aparelho desativou
    }
  }
  return { aparelhos: (subs || []).length, enviados: ok };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method === "GET") return json({ chave: (await chaves()).vapid_pub });
    const body = await req.json().catch(() => ({}));

    if (body.teste) {
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
      if (!data?.user) return json({ erro: "Faça login no Dashplasso." }, 401);
      return json({ ok: true, ...(await enviar(data.user.id, { title: "Dashplasso", body: "Notificações ativadas neste aparelho ✅", url: SITE + "aprovacao.html", tag: "teste" })) });
    }

    const id = Number(body.id);
    if (!id) return json({ erro: "id obrigatório" }, 400);
    // marca como enviada ANTES de mandar: cada notificação sai uma vez só
    const { data: n } = await db.from("notificacoes").update({ enviada_em: new Date().toISOString() })
      .eq("id", id).is("enviada_em", null).select("*").maybeSingle();
    if (!n) return json({ ok: true, ja: true });
    // dá um instante para o comentário do ajuste chegar, se veio em outra chamada
    if (n.tipo === "ajuste" && !n.comentario) {
      await new Promise((r) => setTimeout(r, 2500));
      const { data: n2 } = await db.from("notificacoes").select("comentario").eq("id", id).maybeSingle();
      if (n2?.comentario) n.comentario = n2.comentario;
    }
    const aprovado = n.tipo === "aprovado";
    const payload = {
      title: aprovado ? `✅ ${n.cliente} aprovou` : `✏️ ${n.cliente} pediu ajuste`,
      body: (n.titulo || "Conteúdo") + (n.comentario ? `\n“${String(n.comentario).slice(0, 160)}”` : ""),
      url: SITE + "aprovacao.html?cliente=" + encodeURIComponent(n.cliente || ""),
      tag: "n" + n.id,
    };
    return json({ ok: true, ...(await enviar(n.owner, payload)) });
  } catch (e) {
    return json({ erro: String((e as Error).message || e) }, 500);
  }
});
