// Supabase Edge Function: analisar-orcamento
// Quando chega um orçamento pelo site (bio/), analisa o Instagram do cliente
// levando em conta o que ele escreveu (ex.: "quero vender mais") e grava a análise
// na coleção "crm_analise" (id = id do lead). O CRM mostra no card do lead.
//
// Quem chama:
//   • o banco, logo depois de gravar o orçamento (site_orcamento → pg_net)
//   • o CRM, como reforço, se um lead do site ficou sem análise
//   • o CRM, botão "Refazer análise" (logado + forcar: refaz mesmo que já exista)
//
// Sem login, só analisa lead que veio do site e que ainda não tem análise:
// não dá para gastar a API à toa nem ler nada do banco por aqui.
//
// Publicar: Supabase > Edge Functions > analisar-orcamento, com "Verify JWT" DESLIGADO.
// Secrets: ANTHROPIC_API_KEY, META_IG_TOKEN (e opcional META_IG_USER_ID).
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2.50.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function chaveServico(): string {
  const legado = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legado) return legado;
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return k.default || Object.values(k)[0] as string; }
  catch { return ""; }
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, chaveServico(), { auth: { persistSession: false } });

const TOKEN = (Deno.env.get("META_IG_TOKEN") ?? "").trim().replace(/^.*META_IG_TOKEN\s*=\s*/i, "").replace(/^["']+|["']+$/g, "").replace(/\s+/g, "");
const GRAPH = TOKEN.startsWith("IG") ? "https://graph.instagram.com/v23.0" : "https://graph.facebook.com/v23.0";
const IG_ID = Deno.env.get("META_IG_USER_ID") || "17841454339423114"; // @marcelohbuzeli (quem consulta)
const COL = "crm_analise";

// ---------- Instagram ----------
const usuarioDe = (s: unknown) => {
  const t = String(s ?? "").trim();
  const m = t.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const u = (m ? m[1] : t).replace(/^@+/, "").replace(/[/?#].*$/, "").trim();
  return /^[A-Za-z0-9._]{1,30}$/.test(u) ? u.toLowerCase() : "";
};

type Post = { tipo: string; formato?: string; legenda: string; curtidas?: number; comentarios?: number; data: string; link: string; imagem?: string };
type Perfil = { usuario: string; nome?: string; bio?: string; site?: string; seguidores?: number; seguindo?: number; publicacoes?: number; foto?: string; posts: Post[] };

async function perfilPelaApi(usuario: string): Promise<{ perfil?: Perfil; erro?: string }> {
  if (!TOKEN) return { erro: "sem token do Instagram" };
  const campos = `business_discovery.username(${usuario}){username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,media.limit(15){caption,media_type,media_product_type,like_count,comments_count,timestamp,permalink,media_url,thumbnail_url}}`;
  try {
    const r = await fetch(`${GRAPH}/${IG_ID}?${new URLSearchParams({ fields: campos, access_token: TOKEN })}`);
    const j = await r.json();
    if (!r.ok || j.error) return { erro: j?.error?.message || `HTTP ${r.status}` };
    const b = j.business_discovery;
    if (!b) return { erro: "perfil não encontrado" };
    return {
      perfil: {
        usuario: b.username, nome: b.name, bio: b.biography, site: b.website,
        seguidores: b.followers_count, seguindo: b.follows_count, publicacoes: b.media_count, foto: b.profile_picture_url,
        posts: (b.media?.data || []).map((m: Record<string, unknown>) => ({
          tipo: String(m.media_type || ""), formato: m.media_product_type as string | undefined,
          legenda: String(m.caption || "").slice(0, 600),
          curtidas: m.like_count as number | undefined, comentarios: m.comments_count as number | undefined,
          data: String(m.timestamp || "").slice(0, 10), link: String(m.permalink || ""),
          imagem: (m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url) as string | undefined,
        })),
      },
    };
  } catch (e) { return { erro: String((e as Error).message || e) }; }
}

async function imagemBase64(url: string) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const tipo = (r.headers.get("content-type") || "").split(";")[0];
    if (!/^image\/(jpeg|png|webp|gif)$/.test(tipo)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 3_500_000) return null;
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { type: "image" as const, source: { type: "base64" as const, media_type: tipo as "image/jpeg", data: btoa(s) } };
  } catch { return null; }
}

// ---------- análise ----------
const SYSTEM = `Você é o estrategista da Plassô, a agência de marketing do Marcelo H Buzeli em Umuarama (PR).
A Plassô faz: vídeos (Reels com roteiro, gravação no negócio e edição), design (posts, carrosséis, stories e capas), gestão de Instagram (planejamento, conteúdo, publicação e relatório) e consultoria.

Um cliente acabou de pedir orçamento pelo site. Sua tarefa: analisar o Instagram dele à luz do que ele escreveu e entregar ao Marcelo um diagnóstico para ele abrir a conversa já sabendo o que dizer.

Como analisar:
- Parta do objetivo que o cliente escreveu (ex.: "quero vender mais") e responda a essa pergunta: o que no perfil hoje impede isso?
- Olhe o que existe de verdade: bio (diz o que vende, para quem, onde e como comprar?), link, frequência e regularidade das postagens, formatos (Reels, carrossel, foto), qualidade visual das imagens, ganchos e legendas, chamadas para ação, se o dono ou a equipe aparece, prova social, engajamento em relação ao número de seguidores.
- Cada problema precisa de uma evidência concreta do perfil (um post, um número, um trecho da bio). Nada genérico.
- Se não deu para ler o perfil, diga isso com clareza em "limitacoes", e baseie a análise no que o cliente escreveu e no que for público. Nunca invente números, posts ou fatos.
- Recomende o serviço da Plassô que resolve o problema principal, com o porquê.
- A mensagem de WhatsApp é do Marcelo para o cliente: calma, frases curtas, sem jargão, sem frase de coach, sem emoji em excesso. Mostra que ele olhou o perfil (cita um ponto concreto) e convida para conversar. Não manda preço.
- Escreva em português do Brasil, direto ao ponto.`;

const schema = {
  type: "object", additionalProperties: false,
  required: ["resumo", "objetivo", "nota_perfil", "o_que_ja_faz_bem", "por_que_nao_vende", "oportunidades", "servico_recomendado", "por_que_servico", "mensagem_whatsapp", "perguntas_reuniao", "limitacoes"],
  properties: {
    resumo: { type: "string", description: "2 a 3 frases: quem é o negócio e o diagnóstico central" },
    objetivo: { type: "string", description: "O que o cliente quer, em uma frase, a partir do que ele escreveu" },
    nota_perfil: { type: "integer", description: "0 a 10: o quanto o perfil hoje ajuda a vender" },
    o_que_ja_faz_bem: { type: "array", items: { type: "string" } },
    por_que_nao_vende: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["problema", "evidencia", "como_resolver"], properties: { problema: { type: "string" }, evidencia: { type: "string" }, como_resolver: { type: "string" } } },
    },
    oportunidades: { type: "array", items: { type: "string" }, description: "Ideias rápidas e concretas de conteúdo ou ajuste" },
    servico_recomendado: { type: "string", enum: ["Vídeos", "Design", "Gestão de Instagram", "Consultoria"] },
    por_que_servico: { type: "string" },
    mensagem_whatsapp: { type: "string" },
    perguntas_reuniao: { type: "array", items: { type: "string" } },
    limitacoes: { type: "string", description: "O que não deu para ver (vazio se deu para ler tudo)" },
  },
};

async function analisar(lead: Record<string, unknown>) {
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const usuario = usuarioDe(lead.insta || lead.instagram);
  const { perfil, erro } = usuario ? await perfilPelaApi(usuario) : { perfil: undefined, erro: "cliente não informou o Instagram" };

  const pedido = [
    `Hoje: ${new Date().toISOString().slice(0, 10)}`,
    `<orcamento>`,
    `Nome: ${lead.nomeCompleto || ""}`,
    `Negócio: ${lead.name || ""}`,
    `Cidade: ${lead.bairro || ""}`,
    `Instagram: ${usuario ? "@" + usuario : "não informado"}`,
    `Serviço que marcou: ${lead.product || "não marcou"}`,
    `O que escreveu: ${lead.notas || "nada"}`,
    `</orcamento>`,
  ].join("\n");

  let fonte: string;
  let contexto: string;
  const imagens: Anthropic.ImageBlockParam[] = [];

  if (perfil) {
    fonte = "api";
    const p = { ...perfil, foto: undefined, posts: perfil.posts.map(({ imagem: _i, ...r }) => r) };
    contexto = `<perfil_instagram fonte="API oficial do Instagram">\n${JSON.stringify(p, null, 1)}\n</perfil_instagram>`;
    const urls = perfil.posts.map((x) => x.imagem).filter(Boolean).slice(0, 8) as string[];
    (await Promise.all(urls.map(imagemBase64))).forEach((b) => b && imagens.push(b));
    if (imagens.length) contexto += `\nAs ${imagens.length} imagens anexadas são as capas dos posts mais recentes, na mesma ordem da lista.`;
  } else {
    // Sem a API (perfil pessoal, privado ou token sem acesso): pesquisa o que for público.
    fonte = "pesquisa";
    const pesquisa = await client.messages.create({
      model: "claude-opus-5-5", max_tokens: 6000,
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      messages: [{ role: "user", content: `${pedido}\n\nPesquise na web o que for público sobre este negócio e o Instagram dele (bio, o que vende, frequência de posts, avaliações, site). Liste só fatos encontrados, com a fonte. Se não achar nada, diga que não achou.` }],
    });
    contexto = `<pesquisa_publica motivo_sem_api="${erro || ""}">\n${pesquisa.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("")}\n</pesquisa_publica>`;
  }

  const r = await client.beta.messages.create({
    model: "claude-opus-5-5", max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: "high", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: [...imagens, { type: "text", text: `${pedido}\n\n${contexto}` }] }],
  });
  if (r.stop_reason === "refusal") throw new Error("O modelo recusou a análise.");
  if (r.stop_reason === "max_tokens") throw new Error("Resposta cortada.");
  const texto = r.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  return {
    ...JSON.parse(texto), fonte, usuario,
    perfil: perfil ? { seguidores: perfil.seguidores, publicacoes: perfil.publicacoes, bio: perfil.bio, ultimoPost: perfil.posts[0]?.data } : null,
    erroPerfil: perfil ? null : erro,
  };
}

// ---------- servidor ----------
async function gravar(owner: string, id: string, data: Record<string, unknown>) {
  await db.from("records").upsert({ owner, collection: COL, id, data: { id, ...data }, updated_at: new Date().toISOString() }, { onConflict: "owner,collection,id" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  let body: { id?: string; forcar?: boolean } = {};
  try { body = await req.json(); } catch { /* vazio */ }
  const id = String(body.id || "").slice(0, 80);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return json({ error: "id inválido" }, 400);

  // logado? (CRM) → pode refazer
  const tok = req.headers.get("x-user-token") || "";
  let dono: string | null = null;
  if (tok) { const { data } = await db.auth.getUser(tok); dono = data.user?.id ?? null; }

  let q = db.from("records").select("owner,data").eq("collection", "crm").eq("id", id);
  if (dono) q = q.eq("owner", dono);
  const { data: row } = await q.maybeSingle();
  if (!row) return json({ error: "lead não encontrado" }, 404);
  const lead = row.data as Record<string, unknown>;
  const owner = row.owner as string;

  if (dono && body.forcar) {
    await gravar(owner, id, { status: "analisando", em: new Date().toISOString() });
  } else {
    if (!dono && lead.origem !== "Site · link da bio") return json({ error: "só leads do site" }, 403);
    // trava: só o primeiro pedido grava "analisando"; os outros saem aqui
    const { error } = await db.from("records").insert({ owner, collection: COL, id, data: { id, status: "analisando", em: new Date().toISOString() }, updated_at: new Date().toISOString() });
    if (error) return json({ ok: true, jaExiste: true });
  }

  const trabalho = (async () => {
    try {
      const a = await analisar(lead);
      await gravar(owner, id, { status: "pronta", em: new Date().toISOString(), ...a });
    } catch (e) {
      await gravar(owner, id, { status: "erro", em: new Date().toISOString(), erro: String((e as Error).message || e) });
    }
  })();
  // responde na hora e continua analisando em segundo plano
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) { rt.waitUntil(trabalho); return json({ ok: true, status: "analisando" }, 202); }
  await trabalho;
  return json({ ok: true, status: "pronta" });
});
