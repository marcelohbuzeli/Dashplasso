#!/bin/bash
# Dois cliques ligam o Jarvis em SEGUNDO PLANO: a janela do Terminal fecha sozinha quando ele fica pronto.
# Ele abre pelo Terminal porque é o Terminal que tem a permissão de microfone.
# Para ver tudo ao vivo (testes): ./ligar.command --janela      Para desligar: ./desligar.command
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then bash ./instalar.sh || exit 1; fi
# com opções (--janela, --texto, --voz, --calibrar...) roda aqui mesmo, na janela
if [ $# -gt 0 ]; then [ "$1" = "--janela" ] && shift; exec .venv/bin/python -m jarvis "$@"; fi

fechar_janela() {   # fecha só esta janela, depois que o script terminar
  local eu; eu=$(tty)
  nohup osascript -e "delay 1" -e "tell application \"Terminal\"
    repeat with w in windows
      try
        repeat with t in tabs of w
          if tty of t is \"$eu\" then close w
        end repeat
      end try
    end repeat
  end tell" >/dev/null 2>&1 &
}

if pgrep -f '[.]venv/bin/python -m jarvis$' >/dev/null; then
  echo "O Jarvis já está ligado."
  fechar_janela; exit 0
fi

mkdir -p logs
ANTES=$(wc -l < logs/jarvis.log 2>/dev/null || echo 0)
# processo separado do Terminal (nova sessão): fechar a janela não desliga o Jarvis
PID=$(.venv/bin/python - <<'PY'
import subprocess
p = subprocess.Popen([".venv/bin/python", "-m", "jarvis"], start_new_session=True,
                     stdin=subprocess.DEVNULL, stdout=open("logs/saida.log", "w"), stderr=subprocess.STDOUT)
print(p.pid)
PY
)
echo "Ligando o Jarvis em segundo plano (leva uns 20 segundos)..."
for _ in $(seq 1 150); do
  if tail -n +$((ANTES + 1)) logs/jarvis.log 2>/dev/null | grep -q "\[pronto\]"; then
    echo "Pronto. Esta janela fecha sozinha."
    fechar_janela; exit 0
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo; echo "O Jarvis não ligou. Últimas linhas do registro:"; tail -20 logs/saida.log
    exit 1   # deixa a janela aberta para você ver o erro
  fi
  sleep 1
done
echo "Está demorando mais que o normal; ele continua ligando em segundo plano."
fechar_janela
