#!/usr/bin/env bash
# Corre dentro del emulador (android-emulator-runner). Toma capturas de la app.
set -u
OUT=docs/android-screenshots
mkdir -p "$OUT"
PKG=com.anime.tv
shot() { adb exec-out screencap -p > "$OUT/$1.png"; echo "captura $1 ($(stat -c%s "$OUT/$1.png") bytes)"; }

adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell input keyevent KEYCODE_WAKEUP

# 1) Primer arranque: pantalla de ajustes
adb shell am start -n $PKG/.MainActivity
sleep 6
shot 1-ajustes

# 2) Configurar el servidor (10.0.2.2 = la máquina anfitriona del emulador)
adb shell am force-stop $PKG
adb shell run-as $PKG mkdir -p shared_prefs
cat > /tmp/server.xml <<'XML'
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="url">http://10.0.2.2:8000</string>
    <string name="user">demo</string>
    <string name="pass">demo1234</string>
</map>
XML
adb shell "run-as $PKG sh -c 'cat > shared_prefs/server.xml'" < /tmp/server.xml

# esperar metadatos (pósters) del servidor, máx. 60 s
for i in $(seq 1 30); do
  n=$(curl -s -u demo:demo1234 localhost:8000/api/library | jq '[.[] | select(.meta != null)] | length')
  [ "${n:-0}" -ge 1 ] && break; sleep 2
done

adb shell am start -n $PKG/.MainActivity
sleep 12
shot 2-biblioteca

# 3) Navegar con el control remoto: Tab hasta la primera tarjeta, Enter abre la serie
for k in 1 2 3 4; do adb shell input keyevent KEYCODE_TAB; sleep 1; done
shot 3-foco-tarjeta
adb shell input keyevent KEYCODE_ENTER
sleep 3
shot 4-detalle

# 4) Reproductor nativo: se lanza directo con la lista de episodios de la primera serie
adb root >/dev/null 2>&1; sleep 3
J=$(curl -s -u demo:demo1234 localhost:8000/api/library | jq -c '[.[] | select(.kind=="series")][0].items | map({id:id, url:("/stream/"+id+"?raw=1"), subs:(.subs | map({label:.label, url:("/sub/"+(.id // "")+"/"+(.n|tostring))}))})')
# las rutas /sub necesitan el id del episodio: se reconstruyen aquí
J=$(curl -s -u demo:demo1234 localhost:8000/api/library | jq -c '[.[] | select(.kind=="series")][0].items | map(. as $i | {id:$i.id, url:("/stream/"+$i.id+"?raw=1"), subs:($i.subs | map({label:.label, url:("/sub/"+$i.id+"/"+(.n|tostring))}))})')
echo "playlist: $J"
adb shell am start -n $PKG/.PlayerActivity --es playlist "'$J'" --ei index 0 --es saved "'{}'"
sleep 4
shot 5-reproductor-subtitulo
adb shell input keyevent KEYCODE_DPAD_CENTER
sleep 2
shot 6-reproductor-controles

adb logcat -d -t 400 > "$OUT/logcat.txt" 2>/dev/null || true
