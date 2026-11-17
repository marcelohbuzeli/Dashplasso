"""Jarvis — assistente de voz.

    python -m jarvis               liga o Jarvis (ouvindo "Ei, Jarvis" e duas palmas)
    python -m jarvis --texto "..."  manda um pedido digitado (sem microfone)
    python -m jarvis --calibrar     mostra os níveis do microfone, da palavra e das palmas
    python -m jarvis --voz "..."    testa a voz
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

from .config import Config

COMANDOS_PARAR = ("para", "parar", "pare", "cancela", "cancelar", "chega", "silêncio", "cala a boca")
COMANDOS_NOVA = ("nova conversa", "começar de novo", "esquece isso", "esquece tudo")


def agora() -> str:
    return time.strftime("%H:%M:%S")


def notificar(titulo: str, texto: str):
    texto = texto.replace('"', "'").replace("\\", "")[:240]
    subprocess.Popen(["osascript", "-e", f'display notification "{texto}" with title "{titulo}"'],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def normal(t: str) -> str:
    return re.sub(r"[^\wà-ú ]", "", t.lower()).strip()


class Jarvis:
    def __init__(self, cfg: Config, com_microfone: bool = True):
        from .cerebro import Cerebro
        from .voz import Fala
        self.cfg = cfg
        self.fala = Fala(cfg)
        self.cerebro = Cerebro(cfg, log=self.log)
        self.rapido = None
        self.dia = None
        self.historico: list[str] = []   # últimas falas, para o Jarvis completo saber do que se falava
        if cfg.modo_rapido:
            from .cerebro import CerebroRapido
            from .dia import DiaPronto
            self.rapido = CerebroRapido(cfg, self.cerebro, log=self.log)
            self.dia = DiaPronto(cfg, log=self.log)
            self.rapido.aquecer()
        self.aguardando_continuacao = False
        self.painel = None
        self.ouvindo = False
        self.contexto_hora = 0.0
        self.contexto = ""          # aviso recente do Jarvis (ex.: pedido de edição chegou)
        self.mic = None
        if com_microfone:
            from .audio import Gravador, Microfone, Palmas, Wake
            from .voz import Ouvido
            self.log("[início] carregando a transcrição (Whisper)...")
            self.ouvido = Ouvido(cfg)
            self.mic = Microfone(cfg)
            self.wake = Wake(cfg) if cfg.wake_ativo else None
            self.palmas = Palmas(cfg) if cfg.palmas_ativo else None
            self.gravador = Gravador(cfg, self.mic)

    def emitir(self, ev: dict):
        if self.painel:
            self.painel.emitir(ev)

    def mostrar_na_tela(self, ev: dict):
        """Toda tela nova: abre a aba Jarvis se não estiver aberta e guarda no Dashplasso."""
        if self.painel and not self.painel.conectados():
            subprocess.Popen(["open", self.cfg.extras.get(
                "painel_url", "https://marcelohbuzeli.github.io/Dashplasso/jarvis.html")])

        def guardar():
            try:
                from .dashplasso import Dashplasso
                db = Dashplasso(self.cfg)
                atual = db.obter("jarvis_telas", "recentes") or {"id": "recentes", "telas": []}
                item = {k: v for k, v in ev.items() if k != "tipo"}
                atual["telas"] = (atual.get("telas", []) + [item])[-20:]
                db.salvar("jarvis_telas", atual)
            except Exception as e:  # noqa: BLE001
                self.log(f"[painel] não guardei a tela no Dashplasso: {e}")
        threading.Thread(target=guardar, daemon=True).start()

    def vigiar_estado(self):
        while True:
            if self.fala.falando.is_set():
                e = "falando"
            elif self.ouvindo:
                e = "ouvindo"
            elif self.cerebro.ocupado() or (self.rapido and self.rapido.ocupado()):
                e = "pensando"
            else:
                e = "repouso"
            self.emitir({"tipo": "estado", "valor": e})
            time.sleep(0.1)

    def log(self, msg: str):
        linha = f"{agora()} {msg}"
        print(linha, flush=True)
        with open(Path(self.cfg.logs) / "jarvis.log", "a", encoding="utf-8") as f:
            f.write(linha + "\n")

    # ---------- pedido → cérebro → voz ----------
    def pedir(self, texto: str):
        n = normal(texto)
        if n in COMANDOS_PARAR or any(n.startswith(c + " ") and len(n) < 25 for c in COMANDOS_PARAR):
            self.fala.calar()
            k = self.cerebro.cancelar_tudo() + (self.rapido.cancelar() if self.rapido else 0)
            self.fala.dizer("Parei." if k else "Ok.")
            return
        if any(c in n for c in COMANDOS_NOVA) and len(n) < 40:
            self.cerebro.nova_conversa()
            self.historico.clear()
            if self.rapido:
                self.rapido.nova_conversa()
            self.fala.dizer("Certo, começando do zero.")
            return

        self.log(f"[você] {texto}")
        self.emitir({"tipo": "fala", "quem": "voce", "texto": texto})
        if self.contexto and time.time() - self.contexto_hora < 180:
            texto_cerebro = f"[Contexto: {self.contexto}]\nO Marcelo respondeu: {texto}"
            self.contexto = ""
            return self.executar(texto, texto_cerebro, rapido=False)   # pedido da fila: vai direto ao completo
        self.contexto = ""
        return self.executar(texto, texto, rapido=self.rapido is not None)

    def executar(self, texto: str, texto_cerebro: str, rapido: bool):
        from .voz import Frases
        if not rapido and self.historico:
            texto_cerebro = ("[Conversa recente com o Jarvis rápido:\n" + "\n".join(self.historico[-6:]) +
                             "]\n\n" + texto_cerebro)
        paralela = (not rapido) and self.cerebro.ocupado()
        if paralela:
            self.fala.dizer("Ainda estou na tarefa anterior, mas já cuido disso também.")
        frases = Frases(self.fala)
        estado = {"links": False, "falou": False}

        def ao_texto(pedaco: str):
            if estado["links"]:
                frases.tudo += pedaco
                return
            junto = frases.buf + pedaco
            if "LINKS:" in junto:
                antes = junto.split("LINKS:", 1)[0]
                frases.buf = ""
                frases.adicionar(antes)
                frases.terminar()
                frases.tudo += pedaco
                estado["links"] = True
                return
            estado["falou"] = True
            frases.adicionar(pedaco)

        def ao_terminar(t):
            frases.terminar()
            dur = (t.fim or time.time()) - t.inicio
            if self.dia and (t.escreveu or not rapido):
                self.dia.atualizar_logo()
            if rapido and t.escalar and not t.cancelada:
                self.log(f"[rápido → completo] {texto}")
                self.executar(texto, texto, rapido=False)
                return
            if rapido and t.erro and not t.cancelada:      # modo rápido falhou: tenta no completo
                self.log(f"[rápido] erro, usando o completo: {t.erro}")
                self.executar(texto, texto, rapido=False)
                return
            if t.cancelada:
                self.log(f"[cancelado] {t.pedido}")
                return
            if t.erro:
                self.log(f"[erro] {t.erro}")
                if "login" in t.erro.lower() or "auth" in t.erro.lower() or "401" in t.erro:
                    self.fala.dizer("Não consegui acessar o Claude. Faça o login do Claude Code no Terminal.")
                else:
                    self.fala.dizer("Deu um problema nessa tarefa. Deixei o erro no registro.")
                notificar("Jarvis — erro", t.erro)
                return
            resposta = t.resposta or frases.tudo
            self.log(f"[jarvis {'rápido ' if rapido else ''}{dur:.1f}s] {resposta.strip()}")
            self.historico = (self.historico + [f"Marcelo: {texto}", f"Jarvis: {resposta.split('LINKS:')[0].strip()[:300]}"])[-10:]
            if not estado["falou"] and resposta.strip():
                self.fala.dizer(resposta.split("LINKS:")[0])
            Path(self.cfg.logs, "ultima-resposta.txt").write_text(resposta, encoding="utf-8")
            corpo = resposta.split("LINKS:")
            self.emitir({"tipo": "fala", "quem": "jarvis", "texto": corpo[0].strip()})
            if len(corpo) > 1 and self.painel:
                for url in re.findall(r"https?://\S+", corpo[1]):
                    self.painel.mostrar("Link", url=url.rstrip(").,;"))
            notificar("Jarvis", corpo[1].strip() if len(corpo) > 1 else corpo[0].strip())
            self.aguardando_continuacao = self.mic is not None

        if rapido:
            t = self.rapido.perguntar(texto_cerebro, self.dia.bloco() if self.dia else "", ao_texto, ao_terminar)
        else:
            t = self.cerebro.perguntar(texto_cerebro, ao_texto, ao_terminar, paralela=paralela)

        def aviso():
            time.sleep(self.cfg.aviso_trabalhando_s)
            if t.fim is None and not estado["falou"] and not self.fala.falando.is_set():
                self.fala.dizer("Só um instante.")
        threading.Thread(target=aviso, daemon=True).start()
        return t

    # ---------- avisos do Dashplasso ----------
    def vigiar_fila(self):
        """A cada minuto, olha se chegou pedido de 'Enviar para edição/design' no Dashplasso."""
        from .dashplasso import Dashplasso, ErroDash
        db = Dashplasso(self.cfg)
        arq = Path(self.cfg.logs) / "fila-vista.json"
        try:
            vistos = set(json.loads(arq.read_text())) if arq.exists() else None
        except json.JSONDecodeError:
            vistos = None
        while True:
            try:
                novos = []
                atuais = set()
                for c in db.lista("criacao"):
                    env = c.get("envio")
                    if not isinstance(env, dict) or env.get("concluido"):
                        continue
                    chave = f"{c.get('id')}|{env.get('em')}"
                    atuais.add(chave)
                    if vistos is not None and chave not in vistos:
                        novos.append(c)
                if vistos is None:            # primeira vez: o que já estava na fila não é novidade
                    self.log(f"[dashplasso] conectado; {len(atuais)} pedido(s) já na fila")
                vistos = (vistos or set()) | atuais
                arq.write_text(json.dumps(sorted(vistos)))
                for c in novos:
                    tipo = "edição" if c["envio"].get("tipo") == "edicao" else "design"
                    fmt = (c.get("formato") or "conteúdo").lower()
                    self.log(f"[dashplasso] novo pedido de {tipo}: {c.get('cliente')} — {c.get('titulo')}")
                    self.contexto_hora = time.time()
                    self.contexto = (f"Acabei de avisar por voz que chegou do Dashplasso um pedido de {tipo} "
                                     f"(criacao id {c.get('id')}): {fmt} da {c.get('cliente')}, \"{c.get('titulo')}\". "
                                     f"Perguntei se pode começar. Se ele disser que sim, pegue os dados com "
                                     f"dash_fila_edicao e faça (edição: skill editor-plasso; design: skill design-padrao); "
                                     f"ao terminar, use dash_concluir_envio.")
                    self.fala.dizer(f"Marcelo, chegou um pedido de {tipo} no Dashplasso: {fmt} da "
                                    f"{c.get('cliente')}, {c.get('titulo')}. Quer que eu comece?")
                    self.aguardando_continuacao = self.mic is not None
                    notificar("Jarvis — Dashplasso", f"Pedido de {tipo}: {c.get('cliente')} — {c.get('titulo')}")
            except ErroDash as e:
                self.log(f"[dashplasso] {e}")
                if "dash_email" in str(e):
                    return
            except Exception as e:  # noqa: BLE001
                self.log(f"[dashplasso] erro: {e}")
            time.sleep(60)

    # ---------- laço do microfone ----------
    def ouvir_e_pedir(self, espera: float | None = None) -> bool:
        self.ouvindo = True
        try:
            audio = self.gravador.gravar(espera)
        finally:
            self.ouvindo = False
        if audio is None:
            return False
        self.fala.som("Pop")
        texto = self.ouvido.transcrever(audio)
        if not texto:
            self.log("[ouvido] não entendi")
            return False
        self.pedir(texto)
        return True

    def iniciar_painel(self):
        from .painel import Painel
        self.painel = Painel(self.cfg, ao_pedido=self.pedir, log=self.log)
        self.painel.ao_tela = self.mostrar_na_tela
        self.fala.ao_nivel = lambda v: self.emitir({"tipo": "nivel", "valor": round(v, 3)})
        if self.mic:
            self.gravador.ao_nivel = self.fala.ao_nivel
        threading.Thread(target=self.vigiar_estado, daemon=True).start()

    def rodar(self):
        self.iniciar_painel()
        self.mic.abrir()
        nome = "“Ei, Jarvis”" if self.wake else ""
        palmas = "duas palmas" if self.palmas else ""
        self.log(f"[pronto] chame com {' ou '.join(x for x in (nome, palmas) if x)}. Ctrl+C para sair.")
        self.fala.dizer("Online, Marcelo.")
        threading.Thread(target=self.vigiar_fila, daemon=True).start()
        try:
            while True:
                b = self.mic.ler()
                if b is None:
                    continue
                # Depois que ele termina de falar, ouve a continuação sem precisar chamar.
                if self.aguardando_continuacao and not self.fala.falando.is_set():
                    self.aguardando_continuacao = False
                    time.sleep(0.3)          # deixa o eco da última frase sumir
                    self.mic.esvaziar()
                    self.fala.som("Tink")
                    self.ouvir_e_pedir(espera=self.cfg.continuar_s)
                    continue

                chamou = False
                if self.wake and self.wake.detectou(b):
                    chamou, como = True, "palavra"
                elif self.palmas and self.palmas.detectou(b):
                    chamou, como = True, "palmas"
                if not chamou:
                    if not self.fala.falando.is_set():
                        self.gravador.observar(b)
                    continue

                self.log(f"[chamado] ({como})")
                self.fala.calar()            # chamar no meio da fala interrompe
                self.fala.som("Tink")
                self.mic.esvaziar()
                if self.wake:
                    self.wake.reset()
                self.ouvir_e_pedir()
        except KeyboardInterrupt:
            self.log("[fim] desligando")
        finally:
            self.cerebro.cancelar_tudo()
            self.mic.fechar()


def calibrar(cfg: Config):
    from .audio import Microfone, Palmas, Wake, rms
    mic, wake, palmas = Microfone(cfg), Wake(cfg), Palmas(cfg)
    mic.abrir()
    print("Fale “Ei, Jarvis” e bata duas palmas. Ctrl+C para sair.\n")
    t0, maxw, maxv = time.time(), 0.0, 0.0
    try:
        while True:
            b = mic.ler()
            if b is None:
                continue
            w = wake.pontuar(b)
            maxw, maxv = max(maxw, w), max(maxv, rms(b))
            if palmas.detectou(b):
                print("\n👏👏 DUAS PALMAS detectadas")
            if w >= cfg.wake_limiar:
                print(f"\n🗣  JARVIS detectado (pontuação {w:.2f})")
                wake.reset()
            if time.time() - t0 > 0.5:
                barra = "█" * int(min(maxv * 300, 40))
                print(f"\rvolume {maxv:.3f} {barra:<40} | palavra {maxw:.2f} | pico {palmas.debug_pico:.2f}",
                      end="", flush=True)
                t0, maxw, maxv, palmas.debug_pico = time.time(), 0.0, 0.0, 0.0
    except KeyboardInterrupt:
        print()
    finally:
        mic.fechar()


def main():
    ap = argparse.ArgumentParser(prog="jarvis")
    ap.add_argument("--texto", help="pedido digitado, sem microfone")
    ap.add_argument("--calibrar", action="store_true")
    ap.add_argument("--voz", help="testa a voz com este texto")
    ap.add_argument("--vozes", action="store_true", help="lista as vozes da sua conta ElevenLabs")
    a = ap.parse_args()
    cfg = Config.carregar()

    if a.vozes:
        from .voz import ElevenLabs
        if not cfg.elevenlabs_chave:
            print("Coloque sua chave da ElevenLabs no config.json primeiro.")
            return
        for v in ElevenLabs(cfg).vozes():
            rot = v.get("labels") or {}
            print(f"{v['voice_id']}  {v['name']:<28} {rot.get('gender', '')} {rot.get('accent', '')}")
        return
    if a.voz:
        from .voz import Fala
        f = Fala(cfg)
        f.dizer(a.voz)
        f.esperar()
        return
    if a.calibrar:
        calibrar(cfg)
        return
    if a.texto:
        j = Jarvis(cfg, com_microfone=False)
        if j.dia:                      # espera o painel do dia (no uso normal ele já está pronto)
            for _ in range(50):
                if j.dia.texto:
                    break
                time.sleep(0.2)
        t = j.pedir(a.texto)
        ocioso = 0
        while ocioso < 8:              # espera tudo terminar (inclusive se foi para o completo)
            ocupado = (t is not None and t.fim is None) or j.cerebro.ocupado() or (j.rapido and j.rapido.ocupado())
            ocioso = 0 if ocupado else ocioso + 1
            time.sleep(0.2)
        j.fala.esperar()
        sys.exit(1 if t is not None and t.erro else 0)
    Jarvis(cfg).rodar()


if __name__ == "__main__":
    main()
