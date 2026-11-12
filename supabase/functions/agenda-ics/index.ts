// Supabase Edge Function: agenda-ics
// Lê o "endereço secreto no formato iCal" de uma agenda (Google Agenda, Outlook, iCloud…)
// e devolve os eventos já no horário de Brasília, com repetições expandidas.
// O Notion Calendar usa as contas do Google, então os eventos dele aparecem por aqui.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Ev = { uid: string; titulo: string; local: string; ini: Date; fim: Date | null; diaTodo: boolean; rrule: string; exdates: string[]; recId: string; status: string };

const BR_OFFSET = -3; // Brasil sem horário de verão desde 2019

function unfold(txt: string) { return txt.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, ""); }
function unesc(s: string) { return s.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim(); }

// converte valor de data do ICS para um Date "relógio de Brasília" (guardado como UTC ingênuo)
function parseData(params: string, v: string): { d: Date; diaTodo: boolean } {
  if (/VALUE=DATE(?!-)/.test(params) || /^\d{8}$/.test(v)) {
    return { d: new Date(Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8))), diaTodo: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return { d: new Date(NaN), diaTodo: false };
  let d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
  if (m[7] === "Z") d = new Date(d.getTime() + BR_OFFSET * 3600e3); // UTC -> Brasília
  // com TZID tratamos como horário local (a agenda do usuário é de Brasília)
  return { d, diaTodo: false };
}

function parseICS(txt: string): Ev[] {
  const evs: Ev[] = [];
  const blocos = unfold(txt).split("BEGIN:VEVENT").slice(1);
  for (const b of blocos) {
    const corpo = b.split("END:VEVENT")[0];
    const ev: Ev = { uid: "", titulo: "", local: "", ini: new Date(NaN), fim: null, diaTodo: false, rrule: "", exdates: [], recId: "", status: "" };
    for (const linha of corpo.split("\n")) {
      const i = linha.indexOf(":"); if (i < 0) continue;
      const chave = linha.slice(0, i); const valor = linha.slice(i + 1).trim();
      const [nome, ...ps] = chave.split(";"); const params = ps.join(";");
      if (nome === "UID") ev.uid = valor;
      else if (nome === "SUMMARY") ev.titulo = unesc(valor);
      else if (nome === "LOCATION") ev.local = unesc(valor);
      else if (nome === "STATUS") ev.status = valor;
      else if (nome === "RRULE") ev.rrule = valor;
      else if (nome === "DTSTART") { const r = parseData(params, valor); ev.ini = r.d; ev.diaTodo = r.diaTodo; }
      else if (nome === "DTEND") ev.fim = parseData(params, valor).d;
      else if (nome === "EXDATE") valor.split(",").forEach((x) => ev.exdates.push(parseData(params, x).d.toISOString()));
      else if (nome === "RECURRENCE-ID") ev.recId = parseData(params, valor).d.toISOString();
    }
    if (!isNaN(ev.ini.getTime())) evs.push(ev);
  }
  return evs;
}

const DIAS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function expandir(ev: Ev, de: Date, ate: Date): Date[] {
  if (!ev.rrule) return [ev.ini];
  const r: Record<string, string> = {};
  ev.rrule.split(";").forEach((p) => { const [k, v] = p.split("="); r[k] = v; });
  const freq = r.FREQ, intervalo = Math.max(1, +(r.INTERVAL || 1));
  const count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? parseData("", r.UNTIL).d : null;
  const byday = r.BYDAY ? r.BYDAY.split(",").map((x) => x.replace(/^[+-]?\d+/, "")).map((x) => DIAS[x]).filter((x) => x !== undefined) : [];
  const out: Date[] = [];
  let n = 0, guard = 0;
  const push = (d: Date) => { n++; if ((!until || d <= until) && n <= count) { if (d >= de && d <= ate) out.push(d); } };
  if (freq === "WEEKLY") {
    const dias = byday.length ? byday : [ev.ini.getUTCDay()];
    const semana0 = new Date(ev.ini); semana0.setUTCDate(semana0.getUTCDate() - semana0.getUTCDay());
    for (let w = 0; guard++ < 1500; w += intervalo) {
      for (const dd of [...dias].sort()) {
        const d = new Date(semana0); d.setUTCDate(d.getUTCDate() + w * 7 + dd);
        if (d < ev.ini) continue;
        push(d);
        if (n >= count || (until && d > until) || d > ate) return out;
      }
    }
    return out;
  }
  let d = new Date(ev.ini);
  while (guard++ < 2000) {
    push(new Date(d));
    if (n >= count || (until && d > until) || d > ate) break;
    if (freq === "DAILY") d.setUTCDate(d.getUTCDate() + intervalo);
    else if (freq === "MONTHLY") d.setUTCMonth(d.getUTCMonth() + intervalo);
    else if (freq === "YEARLY") d.setUTCFullYear(d.getUTCFullYear() + intervalo);
    else break;
  }
  return out;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const hm = (d: Date) => d.toISOString().slice(11, 16);

// só aceita chamadas de quem está logado no Plassô (confere o token no próprio Supabase Auth)
async function usuarioLogado(req: Request): Promise<boolean> {
  // o token do usuário vem em x-user-token (a chave pública vai no apikey)
  const tok = req.headers.get("x-user-token") || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const apikey = req.headers.get("apikey") || "";
  if (!/^ey/.test(tok) || !apikey) return false;
  const auth = "Bearer " + tok;
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
    return r.ok;
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  if (!(await usuarioLogado(req))) return json({ error: "Faça login no Plassô para usar esta função." }, 401);
  let body: { url?: string; de?: string; ate?: string };
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  let url = String(body.url || "").trim().replace(/^webcal:\/\//i, "https://");
  if (!/^https:\/\//i.test(url)) return json({ error: "Cole o endereço iCal (começa com https://)." }, 400);
  const de = body.de ? new Date(body.de + "T00:00:00Z") : new Date(Date.now() - 45 * 864e5);
  const ate = body.ate ? new Date(body.ate + "T23:59:59Z") : new Date(Date.now() + 180 * 864e5);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "PlassoAgenda/1.0" } });
    if (!res.ok) return json({ error: `A agenda respondeu ${res.status}. Confira se o endereço secreto está correto.` }, 502);
    const txt = await res.text();
    if (!txt.includes("BEGIN:VCALENDAR")) return json({ error: "Esse endereço não é uma agenda iCal." }, 400);
    const evs = parseICS(txt).filter((e) => e.status !== "CANCELLED");
    const sobrescritos = new Set(evs.filter((e) => e.recId).map((e) => e.uid + "|" + e.recId));
    const out = [];
    for (const ev of evs) {
      const dur = ev.fim ? ev.fim.getTime() - ev.ini.getTime() : 0;
      const datas = ev.recId ? (ev.ini >= de && ev.ini <= ate ? [ev.ini] : []) : expandir(ev, de, ate);
      for (const d of datas) {
        const chave = d.toISOString();
        if (!ev.recId && (ev.exdates.includes(chave) || sobrescritos.has(ev.uid + "|" + chave))) continue;
        const fim = dur ? new Date(d.getTime() + dur) : null;
        out.push({ id: (ev.uid || ev.titulo) + "|" + chave, titulo: ev.titulo || "(sem título)", data: iso(d), hora: ev.diaTodo ? "" : hm(d), horaFim: ev.diaTodo || !fim ? "" : hm(fim), diaTodo: ev.diaTodo, local: ev.local });
        if (out.length > 3000) break;
      }
    }
    out.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
    return json({ eventos: out, total: out.length });
  } catch (e) {
    return json({ error: "Não consegui ler a agenda: " + String((e as Error).message || e) }, 502);
  }
});
