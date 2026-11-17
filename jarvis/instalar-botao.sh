#!/bin/bash
# Instala o "Ligar Jarvis.app" em ~/Applications.
# Ele faz o botão "Ligar Jarvis no Mac" da aba Jarvis funcionar (link plasso-jarvis://ligar)
# e também liga o Jarvis com dois cliques, pelo Launchpad ou pelo Spotlight.
# Rode de novo se mudar a pasta do Jarvis de lugar.
set -euo pipefail

JARVIS_DIR="$(cd "${1:-$(dirname "$0")}" && pwd)"
[ -f "$JARVIS_DIR/ligar.command" ] || { echo "Não achei ligar.command em $JARVIS_DIR"; exit 1; }

APP="$HOME/Applications/Ligar Jarvis.app"
mkdir -p "$HOME/Applications"
rm -rf "$APP"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# O caminho vai entre aspas no AppleScript: escapa \ e "
DIR_AS="${JARVIS_DIR//\\/\\\\}"
DIR_AS="${DIR_AS//\"/\\\"}"

cat > "$TMP/ligar.applescript" <<APPLESCRIPT
property pastaJarvis : "$DIR_AS"

on ligarJarvis()
	-- já está rodando? não abre outro
	try
		do shell script "/usr/bin/pgrep -f '[.]venv/bin/python -m jarvis'"
		display notification "O Jarvis já está ligado." with title "Jarvis"
		return
	end try
	-- abre no Terminal (é ele que tem a permissão de microfone)
	do shell script "/usr/bin/open -a Terminal " & quoted form of (pastaJarvis & "/ligar.command")
	display notification "Ligando… ele diz \"Online\" quando estiver pronto." with title "Jarvis"
end ligarJarvis

on run
	ligarJarvis()
end run

-- chamado pelo botão da aba Jarvis (plasso-jarvis://ligar). O endereço é ignorado: só existe esta ação.
on open location enderecoIgnorado
	ligarJarvis()
end open location
APPLESCRIPT

osacompile -o "$APP" "$TMP/ligar.applescript"

PL="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.plasso.ligarjarvis" "$PL" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.plasso.ligarjarvis" "$PL"
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PL"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$PL"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$PL"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string Ligar Jarvis" "$PL"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PL"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string plasso-jarvis" "$PL"

# assinatura local (o Info.plist mudou) e registro do link no macOS
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"

echo "Pronto: $APP"
echo "Jarvis em: $JARVIS_DIR"
echo "Na aba Jarvis, clique em \"Ligar Jarvis no Mac\". Na primeira vez o Chrome pergunta se pode abrir o app: marque \"sempre permitir\"."
