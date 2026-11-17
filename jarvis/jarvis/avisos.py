"""Avisos do Dashplasso em tempo real, sem ficar consultando o banco.

Quando o site salva alguma coisa (tarefa da casa, extra, conteúdo, agenda, botão "Chamar Design"...),
ele manda um sinal curto pelo Supabase Realtime: {"col": "<coleção>"}. O Jarvis fica conectado
(uma conexão parada, sem gastar nada) e só busca os dados quando recebe esse sinal.

O sinal não traz dados nem ordens: só diz "a coleção X mudou". O Jarvis sempre lê a verdade no banco.
"""
from __future__ import annotations

import asyncio
import json
import threading
import time
from typing import Callable

from .config import Config

EVENTO = "mudou"


def canal(user_id: str) -> str:
    return f"dp-{user_id}"


class Avisos:
    """Conexão com o Realtime. `ao_mudar(colecoes: set[str])` é chamado (numa thread) a cada sinal.
    Sinais em sequência (ex.: marcou 3 tarefas) chegam juntos depois de `juntar_s`."""

    def __init__(self, cfg: Config, ao_mudar: Callable[[set], None], log: Callable[[str], None] = print,
                 juntar_s: float = 2.0):
        self.cfg, self.ao_mudar, self.log, self.juntar = cfg, ao_mudar, log, juntar_s
        self.conectado = False
        self._pendentes: set[str] = set()
        self._trava = threading.Lock()
        self._timer: threading.Timer | None = None
        threading.Thread(target=self._rodar, daemon=True).start()

    # ---------- junta sinais seguidos ----------
    def _sinal(self, col: str):
        with self._trava:
            self._pendentes.add(col or "?")
            if self._timer:
                self._timer.cancel()
            self._timer = threading.Timer(self.juntar, self._disparar)
            self._timer.daemon = True
            self._timer.start()

    def _disparar(self):
        with self._trava:
            cols, self._pendentes = self._pendentes, set()
        try:
            self.ao_mudar(cols)
        except Exception as e:  # noqa: BLE001
            self.log(f"[avisos] erro ao tratar mudança: {e}")

    # ---------- conexão ----------
    def _rodar(self):
        espera = 2
        while True:
            t0 = time.time()
            try:
                asyncio.run(self._conectar())
            except Exception as e:  # noqa: BLE001
                self.log(f"[avisos] conexão caiu: {str(e)[:120]}")
            self.conectado = False
            espera = 2 if time.time() - t0 > 120 else min(espera * 2, 120)
            time.sleep(espera)

    async def _conectar(self):
        import websockets
        from .dashplasso import Dashplasso
        db = Dashplasso(self.cfg)
        token = await asyncio.to_thread(db.token)
        uid = db.sessao.get("user_id")
        if not uid:
            raise RuntimeError("sem user_id na sessão do Dashplasso")
        url = db.url.replace("https://", "wss://") + f"/realtime/v1/websocket?apikey={db.chave}&vsn=1.0.0"
        topico = f"realtime:{canal(uid)}"
        async with websockets.connect(url, ping_interval=None, open_timeout=20) as ws:
            ref = 1
            await ws.send(json.dumps({"topic": topico, "event": "phx_join", "ref": str(ref), "join_ref": str(ref),
                                      "payload": {"config": {"broadcast": {"self": False, "ack": False},
                                                             "presence": {"key": ""}, "private": False},
                                                  "access_token": token}}))

            async def batimento():
                nonlocal ref, token
                n = 0
                while True:
                    await asyncio.sleep(25)          # só mantém a conexão viva; não busca dados
                    ref += 1
                    await ws.send(json.dumps({"topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": str(ref)}))
                    n += 1
                    if n % 100 == 0:                 # ~40 min: renova o login da conexão
                        token = await asyncio.to_thread(db.token)
                        ref += 1
                        await ws.send(json.dumps({"topic": topico, "event": "access_token", "ref": str(ref),
                                                  "payload": {"access_token": token}}))

            tarefa = asyncio.create_task(batimento())
            try:
                async for bruto in ws:
                    m = json.loads(bruto)
                    ev = m.get("event")
                    if ev == "phx_reply" and m.get("topic") == topico and m.get("ref") == "1":
                        if (m.get("payload") or {}).get("status") == "ok":
                            if not self.conectado:
                                self.log("[avisos] ligado: o Jarvis só atualiza quando algo muda no Dashplasso")
                            self.conectado = True
                        else:
                            raise RuntimeError(f"Realtime recusou: {str(m.get('payload'))[:200]}")
                    elif ev == "broadcast" and m.get("topic") == topico:
                        p = m.get("payload") or {}
                        if p.get("event") == EVENTO:
                            col = str((p.get("payload") or {}).get("col") or "")[:40]
                            self._sinal(col)
                    elif ev in ("phx_error", "phx_close") and m.get("topic") == topico:
                        raise RuntimeError(f"canal fechado ({ev})")
            finally:
                tarefa.cancel()
