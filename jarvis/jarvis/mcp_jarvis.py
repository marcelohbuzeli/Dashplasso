"""Conector (MCP) da tela do Jarvis: mostrar coisas na aba Jarvis do Dashplasso."""
from __future__ import annotations

import json

from mcp.server.mcpserver import MCPServer
from websockets.sync.client import connect

from .config import Config
from .painel import porta, token_painel

cfg = Config.carregar()
srv = MCPServer("jarvis_tela", instructions=(
    "Tela do Jarvis: a aba Jarvis do Dashplasso, aberta no navegador do Marcelo. Tudo o que for "
    "para ele VER (links, páginas, imagens, vídeos, pastas e arquivos do Drive, designs do Canva, "
    "textos longos, listas, tabelas) vai para essa tela com jarvis_mostrar, em vez de abrir o navegador."))


def _enviar(msg: dict) -> dict:
    msg["token"] = token_painel(cfg)
    with connect(f"ws://127.0.0.1:{porta(cfg)}", open_timeout=5) as ws:
        ws.send(json.dumps(msg, ensure_ascii=False))
        return json.loads(ws.recv(timeout=5))


@srv.tool()
def jarvis_mostrar(titulo: str, url: str = "", texto: str = "", tipo: str = "auto") -> str:
    """Mostra algo na tela do Jarvis (aba Jarvis do Dashplasso). Se a tela não estiver aberta,
    ela é aberta sozinha.
    - titulo: curto, ex.: "Reels da Carla — versão final"
    - url: link para abrir/embutir (Drive, Canva, YouTube, site, imagem, vídeo...)
    - texto: conteúdo em markdown simples (títulos #, listas -, **negrito**, tabelas |a|b|), opcional
    - tipo: auto | link | imagem | video | drive | texto
    Depois, na fala, diga só "coloquei na tela"."""
    try:
        r = _enviar({"tipo": "tela", "titulo": titulo, "url": url, "texto": texto, "kind": tipo})
        return "Mostrado na tela do Jarvis." + ("" if r.get("paginas_abertas") else " (abrindo a tela no navegador)")
    except Exception as e:  # noqa: BLE001
        return f"Não consegui falar com o Jarvis do Mac (ele está ligado?): {e}"


if __name__ == "__main__":
    srv.run("stdio")
