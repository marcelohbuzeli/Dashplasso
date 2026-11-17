"""Acesso ao banco do Dashplasso (Supabase), entrando como o próprio Marcelo.

O Dashplasso guarda tudo numa tabela `records` (owner, collection, id, data jsonb),
protegida por RLS: só o dono logado lê e escreve os próprios dados. O Jarvis faz login
com o e-mail e a senha do Dashplasso (do config.json) e guarda a sessão em
logs/.dash_sessao (só o seu usuário do Mac consegue ler).
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .config import Config

URL_PADRAO = "https://icarqnbtxrntogfsyavv.supabase.co"
CHAVE_PUBLICA_PADRAO = "sb_publishable_wQqGdpHuTtThE28o73IlNQ_qzV8WkYR"  # pública por design (assets/config.js)


class ErroDash(Exception):
    pass


class Dashplasso:
    def __init__(self, cfg: Config):
        ex = cfg.extras
        self.url = ex.get("dash_url", URL_PADRAO).rstrip("/")
        self.chave = ex.get("dash_chave_publica", CHAVE_PUBLICA_PADRAO)
        self.email = ex.get("dash_email", "")
        self.senha = ex.get("dash_senha", "")
        self.arq_sessao = Path(cfg.logs) / ".dash_sessao"
        self.sessao: dict = {}
        if self.arq_sessao.exists():
            try:
                self.sessao = json.loads(self.arq_sessao.read_text())
            except json.JSONDecodeError:
                self.sessao = {}

    # ---------- HTTP ----------
    def _http(self, metodo: str, caminho: str, corpo=None, token: str | None = None,
              extra: dict | None = None):
        h = {"apikey": self.chave, "Content-Type": "application/json"}
        if token:
            h["Authorization"] = f"Bearer {token}"
        h.update(extra or {})
        req = urllib.request.Request(self.url + caminho, method=metodo, headers=h,
                                     data=json.dumps(corpo).encode() if corpo is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                txt = r.read().decode()
                return json.loads(txt) if txt else None
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:400]
            raise ErroDash(f"HTTP {e.code}: {msg}") from None

    # ---------- login ----------
    def _salvar_sessao(self, s: dict):
        self.sessao = {"access_token": s["access_token"], "refresh_token": s["refresh_token"],
                       "expira": time.time() + int(s.get("expires_in", 3600)) - 60,
                       "user_id": s.get("user", {}).get("id") or self.sessao.get("user_id")}
        self.arq_sessao.write_text(json.dumps(self.sessao))
        os.chmod(self.arq_sessao, 0o600)

    def token(self) -> str:
        if self.sessao.get("access_token") and time.time() < self.sessao.get("expira", 0):
            return self.sessao["access_token"]
        if self.sessao.get("refresh_token"):
            try:
                s = self._http("POST", "/auth/v1/token?grant_type=refresh_token",
                               {"refresh_token": self.sessao["refresh_token"]})
                self._salvar_sessao(s)
                return self.sessao["access_token"]
            except ErroDash:
                pass
        if not (self.email and self.senha):
            raise ErroDash("Sem login do Dashplasso: coloque dash_email e dash_senha no config.json do Jarvis.")
        s = self._http("POST", "/auth/v1/token?grant_type=password",
                       {"email": self.email, "password": self.senha})
        self._salvar_sessao(s)
        return self.sessao["access_token"]

    # ---------- dados ----------
    def lista(self, colecao: str) -> list[dict]:
        q = urllib.parse.urlencode({"select": "id,data,updated_at", "collection": f"eq.{colecao}",
                                    "id": "neq.__value"})
        linhas, ini = [], 0
        while True:
            parte = self._http("GET", f"/rest/v1/records?{q}", token=self.token(),
                               extra={"Range": f"{ini}-{ini + 999}"})
            linhas += parte or []
            if not parte or len(parte) < 1000:
                break
            ini += 1000
        return [r["data"] for r in linhas if isinstance(r.get("data"), dict)]

    def colecoes(self) -> dict[str, int]:
        q = urllib.parse.urlencode({"select": "collection"})
        cont: dict[str, int] = {}
        ini = 0
        while True:
            parte = self._http("GET", f"/rest/v1/records?{q}", token=self.token(),
                               extra={"Range": f"{ini}-{ini + 999}"}) or []
            for r in parte:
                cont[r["collection"]] = cont.get(r["collection"], 0) + 1
            if len(parte) < 1000:
                break
            ini += 1000
        return cont

    def valor(self, colecao: str, padrao=None):
        q = urllib.parse.urlencode({"select": "data", "collection": f"eq.{colecao}", "id": "eq.__value"})
        r = self._http("GET", f"/rest/v1/records?{q}", token=self.token())
        return r[0]["data"].get("v", padrao) if r else padrao

    def obter(self, colecao: str, id_: str) -> dict | None:
        q = urllib.parse.urlencode({"select": "data", "collection": f"eq.{colecao}", "id": f"eq.{id_}"})
        r = self._http("GET", f"/rest/v1/records?{q}", token=self.token())
        return r[0]["data"] if r else None

    def funcao(self, nome: str, corpo: dict) -> dict:
        """Chama uma Edge Function do Dashplasso como o site faz (token do usuário em x-user-token)."""
        return self._http("POST", f"/functions/v1/{nome}", corpo,
                          extra={"x-user-token": self.token()}) or {}

    def agenda_google(self) -> list[dict]:
        """Eventos da(s) agenda(s) conectadas no Calendário do Dashplasso (Google/Notion via iCal)."""
        cfg = self.valor("config_agenda", None)
        if isinstance(cfg, str):
            try:
                cfg = json.loads(cfg)
            except json.JSONDecodeError:
                cfg = None
        if not cfg:
            return []
        urls = [u for u in (cfg.get("urls") or [cfg.get("url")]) if u]
        eventos: list[dict] = []
        for u in urls:
            eventos += self.funcao("agenda-ics", {"url": u}).get("eventos", [])
        return eventos

    def salvar(self, colecao: str, obj: dict):
        self.token()
        linha = {"owner": self.sessao["user_id"], "collection": colecao, "id": str(obj["id"]),
                 "data": obj, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        self._http("POST", "/rest/v1/records?on_conflict=owner,collection,id", [linha],
                   token=self.token(), extra={"Prefer": "resolution=merge-duplicates,return=minimal"})
