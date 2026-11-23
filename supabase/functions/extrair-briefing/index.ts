// Supabase Edge Function: extrair-briefing
// Recebe a transcrição/anotações de uma reunião (ou um briefing antigo em texto livre)
// e distribui o que encontrar nas perguntas do briefing por seções. Não grava nada:
// devolve sugestões, e o Marcelo escolhe o que aplicar na ficha do cliente.
//
// Deploy:  supabase functions deploy extrair-briefing
// Usa o mesmo secret ANTHROPIC_API_KEY do gerar-conteudos.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2.50.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `Você organiza informações de clientes da Plassô, uma agência de marketing de Instagram.
Recebe um texto (transcrição ou anotações de reunião, ou um briefing antigo) e a lista de perguntas do briefing, com a resposta atual de cada uma.

Como trabalhar:
- Para cada pergunta, procure no texto o que responde a ela. Só use o que está no texto: não invente, não deduza números, preços ou resultados.
- Escreva a resposta em português do Brasil, em frases curtas ou tópicos (um por linha, começando com "• " quando for lista).
- Preserve as palavras do cliente quando forem expressões dele (dores, objeções, como ele fala do problema): elas valem ouro para os ganchos. Use aspas nesses casos.
- Se a pergunta já tem resposta atual, devolva a versão completa: a resposta atual mais o que o texto acrescenta, sem repetir. Se o texto contradiz a resposta atual, use o texto e diga isso em "observacoes".
- Se o texto não fala de uma pergunta, não a inclua.
- Em "observacoes", em até 3 frases: o que ficou faltando de importante para criar conteúdo e o que vale perguntar ao cliente.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const tok = req.headers.get("x-user-token") || (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: "Bearer " + tok } },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser(tok);
  if (authError || !user) return json({ error: "Não autorizado" }, 401);

  let body: { clienteId?: string; texto?: string; campos?: { k: string; l: string; secao?: string; atual?: string }[] };
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const texto = String(body.texto ?? "").trim().slice(0, 120000);
  if (texto.length < 40) return json({ error: "Texto muito curto." }, 400);
  const campos = (Array.isArray(body.campos) ? body.campos : [])
    .filter((c) => c && /^[A-Za-z0-9]{1,40}$/.test(String(c.k)) && c.l)
    .slice(0, 80)
    .map((c) => ({ k: String(c.k), l: String(c.l).slice(0, 200), secao: String(c.secao ?? "").slice(0, 80), atual: String(c.atual ?? "").slice(0, 5000) }));
  if (!campos.length) return json({ error: "Lista de perguntas vazia." }, 400);

  // RLS: só o dono lê este cliente
  let nome = "";
  if (body.clienteId) {
    const { data: row } = await supabase.from("records").select("data").eq("collection", "clients").eq("id", body.clienteId).maybeSingle();
    if (!row) return json({ error: "Cliente não encontrado" }, 404);
    const c = row.data as Record<string, unknown>;
    nome = [c.name, c.instagram ? `(${c.instagram})` : ""].filter(Boolean).join(" ");
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["campos", "observacoes"],
    properties: {
      campos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["k", "v"],
          properties: { k: { type: "string", enum: campos.map((c) => c.k) }, v: { type: "string" } },
        },
      },
      observacoes: { type: "string" },
    },
  };

  const perguntas = campos.map((c) => `<pergunta chave="${c.k}" secao="${c.secao}">${c.l}\n<resposta_atual>${c.atual || "(vazia)"}</resposta_atual></pergunta>`).join("\n");
  const pedido = `Cliente: ${nome || "(sem nome)"}\n\n<perguntas>\n${perguntas}\n</perguntas>\n\n<texto>\n${texto}\n</texto>`;

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  try {
    const r = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: pedido }],
    });
    if (r.stop_reason === "refusal") return json({ error: "O modelo recusou este texto." }, 422);
    if (r.stop_reason === "max_tokens") return json({ error: "Resposta cortada. Tente um texto menor." }, 422);
    const out = JSON.parse(r.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(""));
    return json({ campos: out.campos ?? [], observacoes: out.observacoes ?? "", usage: r.usage });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Limite de uso da API atingido. Tente em instantes." }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "ANTHROPIC_API_KEY inválida no Supabase." }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: `Erro da API (${e.status}): ${e.message}` }, 502);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
