// Supabase Edge Function: portfolio  (PÚBLICA — usada pelo site bio/)
// Lista os vídeos da pasta "PORTFOLIO VÍDEOS" do Google Drive, na ordem do Drive.
// Colocou um vídeo novo na pasta → aparece no site (cache de 5 minutos).
// A pasta precisa estar como "Qualquer pessoa com o link" (Leitor).
// Só lê ESTA pasta: não aceita outro link, então não serve para espiar o Drive.
//
// Publicar: Supabase > Edge Functions > portfolio, com "Verify JWT" DESLIGADO.
//
// Nome do arquivo vira o card no site:
//   "[R] Ognus Jeans - Reel 04.mp4"  →  tipo "Reels",   título "Ognus Jeans"
//   "[ADS] Chefinho Store.mov"      →  tipo "Anúncio", título "Chefinho Store"
//   "[EVENTO] Workshop de Risotos"  →  tipo "Evento",  título "Workshop de Risotos"
//   começar o nome com "_" esconde o vídeo do site.

const PASTA = "158-vxqHAgPYTuASF6khBB2-62zIwwVV8";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const TIPOS: Record<string, string> = { R: "Reels", REELS: "Reels", ADS: "Anúncio", AD: "Anúncio", EVENTO: "Evento", DOC: "Documentário", VT: "Institucional" };

const decode = (t: string) =>
  t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).trim();

function card(id: string, nome: string) {
  let base = nome.replace(/\.(mp4|mov|m4v|webm|avi|mkv)$/i, "").trim();
  let tipo = "Vídeo";
  const m = base.match(/^\[([^\]]+)\]\s*/);
  if (m) { tipo = TIPOS[m[1].toUpperCase()] || m[1]; base = base.slice(m[0].length); }
  const titulo = base.replace(/\s*-\s*(reel|reels|vídeo|video)\s*\d*\s*$/i, "").trim();
  return { id, tipo, titulo, nome };
}

let cache: { em: number; dados: unknown } | null = null;

async function listar() {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${PASTA}`, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR" }, redirect: "follow" });
  if (!res.ok || /accounts\.google\.com/.test(res.url)) throw new Error("PRIVADO");
  const html = await res.text();
  const videos = [];
  for (const p of html.split(/class="flip-entry"/).slice(1)) {
    const id = (p.match(/id="entry-([A-Za-z0-9_-]+)"/) || [])[1];
    const nome = decode((p.match(/class="flip-entry-title">([^<]*)</) || [])[1] || "");
    if (!id || !nome || nome.startsWith("_")) continue;
    if (/\/drive\/folders\//.test(p)) continue;
    if (!/\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(nome) && !/video\//i.test(p)) continue;
    videos.push(card(id, nome));
  }
  return { atualizado: new Date().toISOString(), videos };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!cache || Date.now() - cache.em > 5 * 60 * 1000) cache = { em: Date.now(), dados: await listar() };
    return new Response(JSON.stringify(cache.dados), { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=120, s-maxage=300" } });
  } catch (e) {
    if (cache) return new Response(JSON.stringify(cache.dados), { headers: { ...cors, "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ videos: [], erro: String((e as Error).message || e) }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
