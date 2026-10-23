#!/usr/bin/env bash
# Build the launcher APK, install it on the TV, and make it the Home app.
set -euo pipefail
cd "$(dirname "$0")"
TV="192.168.68.57:5555"
APK="app/build/outputs/apk/debug/app-debug.apk"

echo "==> Building"
gradle assembleDebug

echo "==> Installing on $TV"
adb connect "$TV" >/dev/null
adb -s "$TV" install -r "$APK"

echo "==> Setting Basement as Home"
adb -s "$TV" shell cmd package set-home-activity dev.maxxity.basement/.MainActivity
adb -s "$TV" shell input keyevent KEYCODE_HOME
echo "Done. Press Home on the remote."
