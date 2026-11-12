// Supabase Edge Function: gerar-conteudos
// Lê o briefing do cliente no banco (com o login de quem chamou) e pede ao Claude
// um lote de conteúdos (roteiros de Reels, carrosséis, stories, posts).
// A chave da Anthropic fica como "secret" no Supabase — nunca vai para o navegador.
//
// Deploy:  supabase functions deploy gerar-conteudos
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2.50.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const conteudoSchema = {
  type: "object",
  additionalProperties: false,
  required: ["formato", "titulo", "gancho", "roteiro", "legenda", "cta", "hashtags", "orientacoes"],
  properties: {
    formato: { type: "string", enum: ["Reels", "Carrossel", "Story", "Post estático"] },
    titulo: { type: "string", description: "Headline curta e chamativa (o tema do conteúdo)" },
    gancho: { type: "string", description: "Primeira frase / primeiros 3 segundos" },
    roteiro: {
      type: "string",
      description: "Reels/Story: falas e cenas em ordem. Carrossel: texto de cada lâmina, separado por 'Lâmina 1:', 'Lâmina 2:'… Post: texto da arte.",
    },
    legenda: { type: "string", description: "Legenda pronta para o Instagram" },
    cta: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    orientacoes: { type: "string", description: "Dicas de gravação ou de design (enquadramento, cenário, referências visuais)" },
  },
};

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["conteudos"],
  properties: { conteudos: { type: "array", items: conteudoSchema } },
};

const SYSTEM = `Você é o estrategista e roteirista de conteúdo da Plassô, uma agência de marketing.
Cria conteúdos para Instagram em português do Brasil, prontos para gravar ou diagramar, a partir do briefing do cliente.

Como trabalhar:
- Cada conteúdo serve ao objetivo do cliente (atração, autoridade, conexão ou conversão). Varie os ângulos e não repita temas já usados.
- O gancho prende nos primeiros 3 segundos: é específico, concreto e fala com a dor ou o desejo do público.
- Reels: roteiro falado curto (30–60s), frases que soam naturais ditas em voz alta, com indicação de cena entre colchetes quando ajudar.
- Carrossel: de 5 a 8 lâminas. A primeira é a capa com a promessa, a última traz o CTA. Pouco texto por lâmina.
- Respeite o tom de voz, as restrições e o que evitar do briefing. Não invente preços, resultados garantidos, depoimentos ou dados técnicos que o briefing não traz. Em áreas de saúde e estética, siga a ética do conselho profissional: sem promessas de resultado e sem antes/depois sensacionalista.
- Legendas com quebra de linha, um CTA claro e de 3 a 8 hashtags relevantes.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (authError || !user) return json({ error: "Não autorizado" }, 401);

  let body: { clienteId?: string; quantidade?: number; formatos?: Record<string, number>; mes?: string; observacoes?: string; jaCriados?: string[] };
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const quantidade = Math.max(1, Math.min(4, Number(body.quantidade) || 3));
  if (!body.clienteId) return json({ error: "clienteId obrigatório" }, 400);

  // RLS garante que só o dono lê este cliente
  const { data: row, error } = await supabase
    .from("records").select("data").eq("collection", "clients").eq("id", body.clienteId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!row) return json({ error: "Cliente não encontrado" }, 404);
  const c = row.data as Record<string, unknown>;

  const formatos = Object.entries(body.formatos ?? {}).filter(([, n]) => Number(n) > 0).map(([f, n]) => `${n}× ${f}`).join(", ");
  const temasUsados = (body.jaCriados ?? []).slice(-60);

  const pedido = `<cliente>
Nome: ${c.name ?? ""}
Instagram: ${c.instagram ?? ""}
Produto contratado: ${c.produto ?? ""}
Conteúdos por mês no contrato: ${c.quantidadeMes ?? ""}
Objetivo: ${c.objetivo ?? ""}
</cliente>

<briefing>
${c.briefing || "(briefing ainda não preenchido — use o objetivo e o produto, e sinalize nas orientações o que falta saber)"}
</briefing>

<pedido>
Mês de referência: ${body.mes ?? ""}
Crie exatamente ${quantidade} conteúdo(s)${formatos ? `, nesta distribuição: ${formatos}` : ""}.
${body.observacoes ? `Observações do estrategista para este lote: ${body.observacoes}` : ""}
${temasUsados.length ? `Temas já criados (não repita):\n- ${temasUsados.join("\n- ")}` : ""}
</pedido>`;

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort: "medium", format: { type: "json_schema", schema: outputSchema } },
      messages: [{ role: "user", content: pedido }],
    });

    if (response.stop_reason === "refusal") return json({ error: "O modelo recusou este pedido. Revise o briefing." }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "Resposta cortada. Tente um lote menor." }, 422);

    const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const parsed = JSON.parse(text);
    return json({ conteudos: parsed.conteudos ?? [], usage: response.usage });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Limite de uso da API atingido. Tente em instantes." }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "ANTHROPIC_API_KEY inválida no Supabase." }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: `Erro da API (${e.status}): ${e.message}` }, 502);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
