"""O dia na ponta da língua: um resumo curto do Dashplasso que o Jarvis mantém sempre pronto.

Atualiza sozinho a cada poucos minutos (e logo depois de qualquer alteração), para que perguntas
como "o que eu tenho pra hoje?" sejam respondidas na hora, sem consultar o banco.
Inclui: agenda de hoje e amanhã, conteúdos (atrasados, hoje, próximos dias, urgentes, ajustes
pedidos, com o cliente), tarefas da casa vencidas e tarefas extras pendentes.
"""
from __future__ import annotations

import datetime as dt
import threading
import time
from typing import Callable

from .config import Config

FEITOS = ("postado", "aprovadas", "approved")
DIAS_SEMANA = ("segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo")


def _d(s) -> str:
    return str(s or "")[:10]


def _dia_txt(iso: str, hoje: dt.date) -> str:
    try:
        d = dt.date.fromisoformat(iso)
    except ValueError:
        return iso
    n = (d - hoje).days
    if n == 0:
        return "hoje"
    if n == 1:
        return "amanhã"
    if n == -1:
        return "ontem"
    return f"{DIAS_SEMANA[d.weekday()]} {d.day:02d}/{d.month:02d}"


def montar(db, hoje: dt.date | None = None) -> str:
    """Texto compacto (para o modelo, não para falar) com tudo o que importa no dia."""
    hoje = hoje or dt.date.today()
    h, amanha, semana = hoje.isoformat(), (hoje + dt.timedelta(days=1)).isoformat(), (hoje + dt.timedelta(days=7)).isoformat()
    L: list[str] = [f"Hoje é {DIAS_SEMANA[hoje.weekday()]}, {hoje.strftime('%d/%m/%Y')}."]

    tasks = db.lista("tasks")
    eh_post = lambda t: (t.get("kind") or "post") == "post" and not str(t.get("notes", "")).startswith("crm_")

    # ---- agenda (hoje e amanhã) ----
    ag: list[tuple[str, str, str]] = []
    try:
        for e in db.agenda_google():
            if _d(e.get("data")) in (h, amanha):
                ag.append((_d(e.get("data")), e.get("hora") or "", e.get("titulo") or e.get("title") or e.get("resumo") or "evento"))
    except Exception as e:  # noqa: BLE001
        L.append(f"(agenda do Google indisponível: {str(e)[:80]})")
    for e in db.lista("events"):
        if _d(e.get("date")) in (h, amanha):
            ag.append((_d(e.get("date")), e.get("time") or "", e.get("title") or "evento"))
    for t in tasks:
        if not eh_post(t) and _d(t.get("date")) in (h, amanha):
            tipo = {"reuniao": "Reunião", "follow": "Follow-up"}.get(t.get("kind"), "Compromisso")
            ag.append((_d(t.get("date")), t.get("time") or "", f"{tipo}: {t.get('headline') or t.get('title') or ''} {('(' + t['client'] + ')') if t.get('client') else ''}".strip()))
    for dia, nome in ((h, "HOJE"), (amanha, "AMANHÃ")):
        itens = sorted((x for x in ag if x[0] == dia), key=lambda x: x[1] or "99")
        L.append(f"\nAGENDA {nome}: " + ("nada." if not itens else ""))
        L += [f"- {x[1] or 'dia todo'} · {x[2]}" for x in itens]

    # ---- conteúdos da empresa ----
    abertos = [t for t in tasks if eh_post(t) and t.get("status") not in FEITOS]

    def linha(t):
        partes = [t.get("client") or "sem cliente", (t.get("headline") or t.get("title") or "")[:70], t.get("type") or t.get("format") or ""]
        extra = []
        if t.get("date"):
            extra.append(_dia_txt(_d(t["date"]), hoje))
        st = {"urgent": "urgente", "afazer": "a fazer", "pronto": "pronto (com o cliente)"}.get(t.get("status"), t.get("status") or "")
        if st:
            extra.append(st)
        if t.get("isRejected"):
            extra.append("AJUSTE PEDIDO pelo cliente")
        return "- " + " · ".join(p for p in partes if p) + (f" [{', '.join(extra)}]" if extra else "")

    def grupo(titulo, lista):
        L.append(f"\n{titulo} ({len(lista)}):" + (" nenhum." if not lista else ""))
        L.extend(linha(t) for t in sorted(lista, key=lambda t: _d(t.get("date")) or "9999")[:15])
        if len(lista) > 15:
            L.append(f"- … e mais {len(lista) - 15}")

    a_fazer = [t for t in abertos if t.get("status") != "pronto" or t.get("isRejected")]
    grupo("CONTEÚDOS ATRASADOS", [t for t in a_fazer if t.get("date") and _d(t["date"]) < h])
    grupo("CONTEÚDOS PARA HOJE", [t for t in a_fazer if _d(t.get("date")) == h])
    grupo("AJUSTES PEDIDOS PELO CLIENTE", [t for t in abertos if t.get("isRejected")])
    grupo("URGENTES (sem data passada)", [t for t in a_fazer if t.get("status") == "urgent" and not (t.get("date") and _d(t["date"]) <= h)])
    grupo("PRÓXIMOS 7 DIAS", [t for t in a_fazer if h < _d(t.get("date")) <= semana])
    grupo("COM O CLIENTE PARA APROVAR", [t for t in abertos if t.get("status") == "pronto" and not t.get("isRejected")])
    sem_data = [t for t in a_fazer if not t.get("date")]
    if sem_data:
        grupo("SEM DATA", sem_data)

    # ---- casa ----
    venc = []
    for c in db.lista("life_casa"):
        u = _d(c.get("ultimaVez"))
        if u == h:
            continue
        try:
            atraso = (hoje - dt.date.fromisoformat(u)).days - int(c.get("freq") or 1) if u else 999
        except ValueError:
            atraso = 999
        if atraso >= 0:
            venc.append((atraso, c.get("nome", "")))
    venc.sort(reverse=True)
    L.append(f"\nCASA, vencidas ({len(venc)}): " + ("nenhuma." if not venc else ""))
    L += [f"- {n} ({'nunca feita' if a >= 999 else 'vence hoje' if a == 0 else f'{a}d de atraso'})" for a, n in venc]

    # ---- extras ----
    ext = [x for x in db.lista("life_extras") if not x.get("feitaEm")]
    ext.sort(key=lambda x: str(x.get("criadaEm")))
    L.append(f"\nTAREFAS EXTRAS pendentes ({len(ext)}): " + ("nenhuma." if not ext else ""))
    L += [f"- {x.get('nome', '')} (id {x.get('id')}, desde {_dia_txt(_d(x.get('criadaEm')), hoje)})" for x in ext]
    return "\n".join(L)


class DiaPronto:
    """Mantém o resumo atualizado em segundo plano."""

    def __init__(self, cfg: Config, log: Callable[[str], None] = print, intervalo_s: float = 180):
        self.cfg, self.log, self.intervalo = cfg, log, intervalo_s
        self.texto = ""
        self.hora = 0.0
        self._acordar = threading.Event()
        threading.Thread(target=self._laco, daemon=True).start()

    def atualizar_logo(self):
        """Chamar depois de uma alteração (ex.: marcou uma tarefa)."""
        self._acordar.set()

    def _laco(self):
        from .dashplasso import Dashplasso
        db = None
        while True:
            try:
                db = db or Dashplasso(self.cfg)
                t0 = time.time()
                self.texto = montar(db)
                self.hora = time.time()
                self.log(f"[dia] resumo do Dashplasso atualizado ({time.time() - t0:.1f}s, {len(self.texto)} caracteres)")
            except Exception as e:  # noqa: BLE001
                self.log(f"[dia] não consegui atualizar o resumo: {e}")
            self._acordar.wait(self.intervalo)
            self._acordar.clear()
            time.sleep(2)   # junta várias alterações seguidas numa atualização só

    def bloco(self) -> str:
        if not self.texto:
            return ""
        idade = int((time.time() - self.hora) / 60)
        return (f"[PAINEL DO DIA — Dashplasso, atualizado há {idade} min. Use estes dados para responder "
                f"perguntas sobre agenda, tarefas, conteúdos, casa e extras SEM chamar ferramentas. "
                f"Só consulte o banco se precisar de algo que não está aqui.]\n{self.texto}\n[FIM DO PAINEL]")
