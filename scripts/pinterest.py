"""Busca os pins das pastas públicas do Pinterest (feed RSS) e grava inspiracao/pins.json para o cartão Respiro do Dash.
Roda no GitHub Actions a cada 3 horas (.github/workflows/inspiracao.yml). Sem chave, sem login."""
import html, json, re, sys, urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
cfg = json.loads((RAIZ / "inspiracao/fontes.json").read_text())
pins, vistos = [], set()
for pasta in cfg["pastas"]:
    url = f"https://br.pinterest.com/{cfg['usuario']}/{pasta}.rss"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Dash Plasso)"})
        xml = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "replace")
    except Exception as e:  # pasta secreta (404) ou fora do ar: ignora
        print(f"{pasta}: {e}", file=sys.stderr); continue
    for item in re.findall(r"<item>(.*?)</item>", xml, re.S):
        link = (re.search(r"<link>(.*?)</link>", item) or [None, ""])[1].strip()
        desc = html.unescape((re.search(r"<description>(.*?)</description>", item, re.S) or [None, ""])[1])
        img = re.search(r'src="(https://i\.pinimg\.com/[^"]+)"', desc)
        if not img or link in vistos:
            continue
        vistos.add(link)
        titulo = html.unescape((re.search(r"<title>(.*?)</title>", item, re.S) or [None, ""])[1]).strip()
        pins.append({"img": re.sub(r"/\d+x/", "/736x/", img.group(1)), "link": link, "pasta": pasta,
                     "titulo": re.sub(r"\s+", " ", titulo)[:90]})
    print(f"{pasta}: ok", file=sys.stderr)
saida = RAIZ / "inspiracao/pins.json"
novo = json.dumps({"pins": pins[:300]}, ensure_ascii=False, indent=0)
if not saida.exists() or saida.read_text() != novo:
    saida.write_text(novo); print(f"{len(pins)} pins gravados")
else:
    print("sem mudanças")
