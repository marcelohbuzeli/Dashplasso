// Supabase Edge Function: drive-midia
// Recebe um link do Google Drive (pasta ou arquivo) e devolve a lista de fotos e vídeos,
// na mesma ordem em que aparecem no Drive. A pasta/arquivo precisa estar compartilhado como
// "Qualquer pessoa com o link". Não usa chave de API: lê a visualização pública do Drive.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

function parseLink(raw: string): { tipo: "pasta" | "arquivo"; id: string } | null {
  const s = String(raw || "").trim();
  let m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (m) return { tipo: "pasta", id: m[1] };
  m = s.match(/embeddedfolderview\?id=([A-Za-z0-9_-]{10,})/);
  if (m) return { tipo: "pasta", id: m[1] };
  m = s.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) || s.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  if (m) return { tipo: "arquivo", id: m[1] };
  m = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return { tipo: s.includes("folder") ? "pasta" : "arquivo", id: m[1] };
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return { tipo: "pasta", id: s };
  return null;
}

const decode = (t: string) =>
  t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).trim();

const VIDEO_EXT = /\.(mp4|mov|m4v|avi|mkv|webm|3gp|mts|wmv)$/i;
const IMG_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|svg)$/i;

function tipoDe(mime: string, nome: string): "video" | "imagem" | "pasta" | "outro" {
  if (/folder/.test(mime)) return "pasta";
  if (/^video\//.test(mime) || VIDEO_EXT.test(nome)) return "video";
  if (/^image\//.test(mime) || IMG_EXT.test(nome)) return "imagem";
  return "outro";
}

async function listarPasta(id: string) {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" }, redirect: "follow" });
  if (!res.ok || /accounts\.google\.com/.test(res.url)) throw new Error("PRIVADO");
  const html = await res.text();
  if (!html.includes("flip-entry")) {
    if (/accounts\.google\.com|ServiceLogin/.test(html)) throw new Error("PRIVADO");
    return { titulo: "", itens: [] };
  }
  const titulo = decode((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "");
  const partes = html.split(/class="flip-entry"/).slice(1);
  const itens = [];
  for (const p of partes) {
    const fid = (p.match(/id="entry-([A-Za-z0-9_-]+)"/) || [])[1];
    if (!fid) continue;
    const nome = decode((p.match(/class="flip-entry-title">([^<]*)</) || [])[1] || "");
    const mime = ((p.match(/\/type\/([a-z0-9.+-]+\/[a-z0-9.+-]+)/i) || [])[1] || "").toLowerCase();
    const ehPasta = /\/drive\/folders\//.test(p) || /folder/.test(mime);
    itens.push({ id: fid, nome, mime, tipo: ehPasta ? "pasta" : tipoDe(mime, nome) });
  }
  return { titulo, itens };
}

async function infoArquivo(id: string) {
  const res = await fetch(`https://drive.google.com/file/d/${id}/view`, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" }, redirect: "follow" });
  if (!res.ok || /accounts\.google\.com/.test(res.url)) throw new Error("PRIVADO");
  const html = await res.text();
  let nome = decode((html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || "");
  nome = nome.replace(/\s*-\s*Google Drive\s*$/i, "");
  const mime = ((html.match(/"(video\/[a-z0-9.+-]+|image\/[a-z0-9.+-]+)"/i) || [])[1] || "").toLowerCase();
  let tipo = tipoDe(mime, nome);
  if (tipo === "outro" && /og:video|videoplayback|"video"/.test(html)) tipo = "video";
  if (tipo === "outro") tipo = "imagem";
  return { titulo: nome, itens: [{ id, nome, mime, tipo }] };
}

// só aceita chamadas de quem está logado no Plassô (confere o token no próprio Supabase Auth)
async function usuarioLogado(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  const apikey = req.headers.get("apikey") || "";
  if (!/^Bearer\s+ey/i.test(auth) || !apikey) return false;
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
    return r.ok;
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  if (!(await usuarioLogado(req))) return json({ error: "Faça login no Plassô para usar esta função." }, 401);
  let body: { url?: string; subpastas?: boolean };
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const ref = parseLink(body.url || "");
  if (!ref) return json({ error: "Não reconheci esse link do Google Drive. Cole o link da pasta ou do arquivo." }, 400);
  try {
    const out = ref.tipo === "pasta" ? await listarPasta(ref.id) : await infoArquivo(ref.id);
    let itens = out.itens;
    // se a pasta só tiver subpastas, abre a primeira camada delas (ex.: uma pasta por lâmina)
    if (ref.tipo === "pasta" && body.subpastas !== false && itens.length && itens.every((i) => i.tipo === "pasta")) {
      const sub = [];
      for (const pasta of itens.slice(0, 12)) {
        try { const r = await listarPasta(pasta.id); sub.push(...r.itens.filter((i) => i.tipo !== "pasta")); } catch { /* ignora */ }
      }
      itens = sub;
    }
    const midias = itens.filter((i) => i.tipo === "video" || i.tipo === "imagem");
    return json({ origem: ref, titulo: out.titulo, total: itens.length, midias, ignorados: itens.length - midias.length });
  } catch (e) {
    if ((e as Error).message === "PRIVADO") {
      return json({ error: 'O Drive não liberou o acesso. Compartilhe a pasta como "Qualquer pessoa com o link" (Leitor) e tente de novo.' }, 403);
    }
    return json({ error: "Não consegui ler o Drive agora: " + String((e as Error).message || e) }, 502);
  }
});
