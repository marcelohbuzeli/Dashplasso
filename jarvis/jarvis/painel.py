"""Ponte em tempo real entre o Jarvis do Mac e a aba Jarvis do Dashplasso.

Servidor WebSocket em 127.0.0.1 (só este Mac). A página recebe:
  {"tipo": "estado", "valor": "repouso|ouvindo|pensando|falando"}
  {"tipo": "nivel",  "valor": 0..1}            (volume da voz, ~20x por segundo)
  {"tipo": "fala",   "quem": "voce|jarvis", "texto": "..."}
  {"tipo": "tela",   "id", "titulo", "kind", "url", "texto", "hora"}   (algo para mostrar)
A página pode mandar {"tipo": "pedido", "texto": "..."} (digitar um pedido).
O conector do Claude manda {"tipo": "tela", "token": ..., ...} para mostrar coisas.

Segurança:
- só escuta em 127.0.0.1 (nada de fora do Mac alcança);
- página do site só entra se mandar o token de login do Supabase e ele for do MESMO dono;
- origem comparada por esquema+host exatos (localhost só para páginas servidas por este Mac);
- quem não for página (o conector do Claude) precisa do token em logs/.painel_token.
"""
from __future__ import annotations

import asyncio
import json
import secrets
import threading
import time
from pathlib import Path
from typing import Callable

from websockets.asyncio.server import serve

from .config import Config

SITE = ("https", "marcelohbuzeli.github.io")
LOCAIS = {"localhost", "127.0.0.1"}


def origem_ok(origem: str) -> tuple[bool, bool]:
    """(é página permitida, precisa de login). Compara esquema e host exatos — nada de prefixo."""
    from urllib.parse import urlsplit
    try:
        u = urlsplit(origem)
    except ValueError:
        return False, False
    host = (u.hostname or "").lower()
    if (u.scheme, host) == SITE and u.port is None:
        return True, True
    if u.scheme == "http" and host in LOCAIS:
        return True, False      # página servida por este próprio Mac (testes)
    return False, False


def token_painel(cfg: Config) -> str:
    arq = Path(cfg.logs) / ".painel_token"
    if not arq.exists():
        arq.write_text(secrets.token_urlsafe(24))
        arq.chmod(0o600)
    return arq.read_text().strip()


def porta(cfg: Config) -> int:
    return int(cfg.extras.get("painel_porta", 8765))


class Painel:
    def __init__(self, cfg: Config, ao_pedido: Callable[[str], None], log=print):
        self.cfg = cfg
        self.ao_pedido = ao_pedido
        self.log = log
        self.token = token_painel(cfg)
        self.clientes: set = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.estado = "repouso"
        self.telas: list[dict] = []
        self.falas: list[dict] = []
        self.ao_tela: Callable[[dict], None] | None = None
        threading.Thread(target=self._rodar, daemon=True).start()

    # ---------- API para o Jarvis (qualquer thread) ----------
    def conectados(self) -> int:
        return len(self.clientes)

    def emitir(self, ev: dict):
        if ev.get("tipo") == "estado":
            if ev["valor"] == self.estado:
                return
            self.estado = ev["valor"]
        elif ev.get("tipo") == "fala":
            self.falas = (self.falas + [ev])[-20:]
        elif ev.get("tipo") == "tela":
            self.telas = (self.telas + [ev])[-30:]
        if self.loop and self.clientes:
            asyncio.run_coroutine_threadsafe(self._enviar_todos(ev), self.loop)

    def mostrar(self, titulo: str, url: str = "", texto: str = "", kind: str = "auto") -> dict:
        ev = {"tipo": "tela", "id": f"t{int(time.time() * 1000):x}", "titulo": titulo, "url": url,
              "texto": texto, "kind": kind, "hora": time.strftime("%Y-%m-%dT%H:%M:%S")}
        self.emitir(ev)
        if self.ao_tela:
            self.ao_tela(ev)
        return ev

    def _login_valido(self, token: str) -> bool:
        """Confere no Supabase se o token é de um usuário logado e se é o MESMO dono do Jarvis."""
        if len(token) < 20:
            return False
        try:
            from .dashplasso import Dashplasso
            db = Dashplasso(self.cfg)
            meu = db.token() and db.sessao.get("user_id")
            quem = db._http("GET", "/auth/v1/user", token=token) or {}
            ok = bool(meu) and quem.get("id") == meu
            if not ok:
                self.log("[painel] conexão recusada: login de outro usuário ou inválido")
            return ok
        except Exception as e:  # noqa: BLE001
            self.log(f"[painel] conexão recusada: {e}")
            return False

    # ---------- servidor ----------
    async def _enviar_todos(self, ev: dict):
        msg = json.dumps(ev, ensure_ascii=False)
        for ws in list(self.clientes):
            try:
                await ws.send(msg)
            except Exception:  # noqa: BLE001
                self.clientes.discard(ws)

    async def _atender(self, ws):
        origem = ws.request.headers.get("Origin") or ""
        eh_pagina, precisa_login = origem_ok(origem) if origem else (False, False)
        if origem and not eh_pagina:
            await ws.close(4003, "origem não permitida")
            return
        if eh_pagina and precisa_login:
            # a página precisa provar que é o Marcelo logado no Dashplasso
            try:
                ola = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            except Exception:  # noqa: BLE001
                await ws.close(4001, "sem login")
                return
            if ola.get("tipo") != "ola" or not await asyncio.to_thread(self._login_valido, str(ola.get("token", ""))):
                await ws.close(4001, "login inválido")
                return
        if eh_pagina:
            self.clientes.add(ws)
            await ws.send(json.dumps({"tipo": "inicio", "estado": self.estado, "telas": self.telas,
                                      "falas": self.falas}, ensure_ascii=False))
        try:
            async for bruto in ws:
                try:
                    msg = json.loads(bruto)
                except json.JSONDecodeError:
                    continue
                if msg.get("tipo") == "pedido" and eh_pagina and str(msg.get("texto", "")).strip():
                    threading.Thread(target=self.ao_pedido, args=(msg["texto"].strip(),), daemon=True).start()
                elif msg.get("tipo") == "tela" and msg.get("token") == self.token:
                    ev = self.mostrar(msg.get("titulo", ""), msg.get("url", ""), msg.get("texto", ""),
                                      msg.get("kind", "auto"))
                    await ws.send(json.dumps({"ok": True, "id": ev["id"], "paginas_abertas": len(self.clientes)}))
                elif msg.get("tipo") == "status" and msg.get("token") == self.token:
                    await ws.send(json.dumps({"ok": True, "paginas_abertas": len(self.clientes)}))
        finally:
            self.clientes.discard(ws)

    def _rodar(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)

        async def principal():
            async with serve(self._atender, "127.0.0.1", porta(self.cfg), max_size=2**20):
                self.log(f"[painel] aba Jarvis pode conectar em ws://127.0.0.1:{porta(self.cfg)}")
                await asyncio.Future()
        try:
            self.loop.run_until_complete(principal())
        except OSError as e:
            self.log(f"[painel] não consegui abrir a porta {porta(self.cfg)}: {e}")
