#!/bin/bash
# Instala o Jarvis de SEGUNDO PLANO: cuida sozinho da fila do "Chamar Design / Chamar Editor" do Dashplasso.
# - Liga sozinho quando você entra no Mac e volta sozinho se cair (launchd).
# - Não usa microfone nem voz: não fala nada. Só uma notificação silenciosa quando começa/termina.
# - Não gasta nada parado: só abre o Claude quando chega um pedido.
# Desinstalar: ./instalar-segundo-plano.sh --remover
set -euo pipefail

JARVIS_DIR="$(cd "$(dirname "$0")" && pwd)"
ROTULO="com.plasso.jarvis-agentes"
PLIST="$HOME/Library/LaunchAgents/$ROTULO.plist"
DOM="gui/$(id -u)"

if [ "${1:-}" = "--remover" ]; then
  launchctl bootout "$DOM/$ROTULO" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Jarvis de segundo plano removido."
  exit 0
fi

[ -x "$JARVIS_DIR/.venv/bin/python" ] || bash "$JARVIS_DIR/instalar.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$JARVIS_DIR/logs"

esc() { local s="${1//&/&amp;}"; s="${s//</&lt;}"; printf '%s' "${s//>/&gt;}"; }
D="$(esc "$JARVIS_DIR")"
CAMINHO="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ROTULO</string>
  <key>ProgramArguments</key>
  <array>
    <string>$D/.venv/bin/python</string>
    <string>-m</string>
    <string>jarvis</string>
    <string>--agentes</string>
  </array>
  <key>WorkingDirectory</key><string>$D</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(esc "$CAMINHO")</string>
    <key>HOME</key><string>$(esc "$HOME")</string>
    <key>LANG</key><string>pt_BR.UTF-8</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$D/logs/segundo-plano.log</string>
  <key>StandardErrorPath</key><string>$D/logs/segundo-plano.log</string>
</dict>
</plist>
PLIST

launchctl bootout "$DOM/$ROTULO" 2>/dev/null || true
launchctl bootstrap "$DOM" "$PLIST"
echo "Jarvis de segundo plano instalado e ligado. Registro: logs/segundo-plano.log"
