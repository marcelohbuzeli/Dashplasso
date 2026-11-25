// Supabase Edge Function: escrever-legenda
// Escreve uma legenda CURTA, que complementa o post (não repete o roteiro), na voz do cliente.
// Lê: o briefing do cliente (tom de voz, público, o que evitar), o roteiro, as fotos e a capa
// dos vídeos do Drive, e as legendas que o cliente já usou (para pegar o jeito de escrever).
// Cada chamada devolve uma versão nova (as anteriores vão no pedido para não repetir).
//
// Deploy:  supabase functions deploy escrever-legenda
// Secret:  usa a mesma ANTHROPIC_API_KEY do gerar-conteudos
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2.50.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["legenda"],
  properties: { legenda: { type: "string", description: "A legenda pronta para colar no Instagram" } },
};

const SYSTEM = `Você é o redator de legendas da Plassô, uma agência de marketing. Escreve legendas de Instagram em português do Brasil.

A regra principal: a legenda é CURTA e COMPLEMENTA o post. Quem vê o post já recebeu o conteúdo pelo vídeo ou pelas lâminas, então a legenda não resume nem repete o roteiro. Ela acrescenta: um contexto, uma reflexão, um bastidor, uma provocação ou um convite que puxa para o post e para a ação.

Como escrever:
- De 1 a 4 linhas curtas de texto, mais um CTA simples. Nada de textão.
- Escreva na voz do cliente: siga o tom de voz, a personalidade, o público e o que evitar do briefing. Se houver legendas anteriores do cliente, imite o jeito de escrever delas (tamanho, pessoa do verbo, emojis, gírias, pontuação, uso de hashtags).
- Olhe as imagens: use o que aparece de fato (cenário, produto, pessoa, clima) quando isso ajudar a complementar. Não descreva a imagem ao pé da letra.
- Hashtags: só se o briefing ou as legendas anteriores do cliente usam; nesse caso, no máximo 5, no fim. Se não houver referência, não use.
- Emojis com moderação, de acordo com o estilo do cliente.
- Não invente preços, resultados garantidos, depoimentos ou dados que não estejam no material. Em saúde e estética, siga a ética do conselho profissional: sem promessa de resultado.
- Se pedirem outra versão, mude o ângulo de verdade (outra abertura, outra ideia), não só troque palavras.
- Devolva só a legenda, sem aspas, sem título e sem explicação.`;

type Midia = { id?: string; nome?: string; tipo?: string };

// baixa a imagem pública do Drive e devolve como bloco de imagem para o Claude
async function imagemDoDrive(m: Midia): Promise<Anthropic.ImageBlockParam | null> {
  if (!m.id || !/^[A-Za-z0-9_-]{10,}$/.test(m.id)) return null;
  const urls = m.tipo === "video"
    ? [`https://drive.google.com/thumbnail?id=${m.id}&sz=w1000`]
    : [`https://lh3.googleusercontent.com/d/${m.id}=w1000`, `https://drive.google.com/thumbnail?id=${m.id}&sz=w1000`];
  for (const url of urls) {
    try {
      const r = await fetch(url, { redirect: "follow" });
      const tipo = (r.headers.get("content-type") || "").split(";")[0].trim();
      if (!r.ok || !/^image\/(jpeg|png|gif|webp)$/.test(tipo)) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length < 500 || buf.length > 4_500_000) continue;
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { type: "image", source: { type: "base64", media_type: tipo as "image/jpeg", data: btoa(bin) } };
    } catch { /* tenta o próximo */ }
  }
  return null;
}

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "A IA ainda não está ligada: falta a chave da Anthropic (ANTHROPIC_API_KEY) no Supabase.", codigo: "sem_chave" }, 503);

  const tok = req.headers.get("x-user-token") || (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: "Bearer " + tok } },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser(tok);
  if (authError || !user) return json({ error: "Não autorizado" }, 401);

  let body: {
    cliente?: string; formato?: string; titulo?: string; objetivo?: string; roteiro?: string; observacoes?: string;
    midias?: Midia[]; anteriores?: string[]; exemplos?: string[]; pedido?: string;
  };
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  if (!String(body.roteiro ?? "").trim() && !(body.midias ?? []).length && !String(body.titulo ?? "").trim())
    return json({ error: "Preencha o roteiro ou busque as mídias do Drive antes de escrever a legenda." }, 400);

  // briefing do cliente (RLS: só o dono lê)
  let c: Record<string, unknown> = {};
  if (body.cliente) {
    const { data: rows } = await supabase.from("records").select("data").eq("collection", "clients");
    const alvo = norm(body.cliente);
    c = ((rows ?? []).map((r) => r.data as Record<string, unknown>).find((d) => norm(d.name) === alvo)) ?? {};
  }
  const campos = ((c.briefingV2 as { campos?: Record<string, { v?: string; s?: string; l?: string }> } | undefined)?.campos) ?? {};
  const porSecao = new Map<string, string[]>();
  for (const [k, f] of Object.entries(campos)) {
    const v = String(f?.v ?? "").trim(); if (!v) continue;
    const sec = f.s || "Outros";
    if (!porSecao.has(sec)) porSecao.set(sec, []);
    porSecao.get(sec)!.push(`${f.l || k}:\n${v}`);
  }
  // a seção de marca e tom de voz vem primeiro
  const secoes = [...porSecao].sort(([a], [b]) => Number(/tom|marca/i.test(b)) - Number(/tom|marca/i.test(a)));
  const briefingTexto = [
    secoes.map(([sec, l]) => `## ${sec}\n${l.join("\n\n")}`).join("\n\n"),
    String(c.briefing ?? "").trim() ? `## Anotações livres\n${String(c.briefing).trim()}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 20000);

  const exemplos = (body.exemplos ?? []).map((e) => String(e).trim()).filter(Boolean).slice(0, 8);
  const anteriores = (body.anteriores ?? []).map((e) => String(e).trim()).filter(Boolean).slice(-6);

  const midias = (body.midias ?? []).filter((m) => m && m.id).slice(0, 8);
  const imagens = (await Promise.all(midias.map(imagemDoDrive))).filter(Boolean) as Anthropic.ImageBlockParam[];
  const temVideo = midias.some((m) => m.tipo === "video");

  const pedido = `<cliente>
Nome: ${body.cliente || c.name || ""}
Instagram: ${c.instagram ?? ""}
Objetivo geral: ${c.objetivo ?? ""}
</cliente>

<briefing>
${briefingTexto || "(briefing não preenchido: siga um tom profissional e próximo)"}
</briefing>
${exemplos.length ? `\n<legendas_anteriores_do_cliente>\n${exemplos.map((e, i) => `--- ${i + 1}\n${e}`).join("\n")}\n</legendas_anteriores_do_cliente>\n` : ""}
<post>
Formato: ${body.formato ?? ""}
Título / tema: ${body.titulo ?? ""}
Objetivo do post: ${body.objetivo ?? ""}
Roteiro / texto das lâminas:
${String(body.roteiro ?? "").slice(0, 12000) || "(sem roteiro)"}
${body.observacoes ? `Observações: ${body.observacoes}` : ""}
</post>

${imagens.length ? `As ${imagens.length} imagem(ns) acima são o material do post, na ordem${temVideo ? " (nos vídeos, é a capa/primeiro quadro; a fala está no roteiro)" : ""}.` : "Sem imagens disponíveis: baseie-se no roteiro."}
${anteriores.length ? `\nVersões que já escrevi para este post (escreva outra, com um ângulo diferente):\n${anteriores.map((a) => `- ${a.replace(/\n+/g, " / ")}`).join("\n")}` : ""}
${body.pedido ? `\nPedido do Marcelo para esta versão: ${body.pedido}` : ""}

Escreva a legenda.`;

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort: "medium", format: { type: "json_schema", schema: outputSchema } },
      messages: [{ role: "user", content: [...imagens, { type: "text", text: pedido }] }],
    });
    if (response.stop_reason === "refusal") return json({ error: "O modelo recusou este pedido." }, 422);
    const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const { legenda } = JSON.parse(text);
    return json({ legenda: String(legenda ?? "").trim(), imagensLidas: imagens.length, usage: response.usage });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Limite de uso da API atingido. Tente em instantes." }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "ANTHROPIC_API_KEY inválida no Supabase." }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: `Erro da API (${e.status}): ${e.message}` }, 502);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
