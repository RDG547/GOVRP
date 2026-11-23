#!/usr/bin/env bash
set -Eeuo pipefail
mkdir -p twa-android/app/build/smoke-logs
adb wait-for-device
adb shell getprop ro.build.version.release | tee twa-android/app/build/smoke-logs/android_version.txt
adb shell pm list packages | grep -E '(chrome|browser|vending)' | tee twa-android/app/build/smoke-logs/browser_packages.txt || true
adb install -r twa-android/app/build/outputs/apk/debug/app-debug.apk
adb logcat -c
adb shell am start -W -n com.worldofsimulators.app/com.google.androidbrowserhelper.trusted.LauncherActivity | tee twa-android/app/build/smoke-logs/startup.txt
sleep 18
adb logcat -d -v time > twa-android/app/build/smoke-logs/logcat.txt
if grep -E -A 28 'FATAL EXCEPTION|Process: com.worldofsimulators.app' twa-android/app/build/smoke-logs/logcat.txt | grep -E 'FATAL EXCEPTION|Process: com.worldofsimulators.app'; then
  echo 'Found uncaught Android process exception in app launch:' >&2
  grep -E -A 40 'FATAL EXCEPTION' twa-android/app/build/smoke-logs/logcat.txt | tail -n 70 >&2
  exit 1
fi
if grep -E -i 'force finishing activity .*worldofsimulators|has crashed.*worldofsimulators' twa-android/app/build/smoke-logs/logcat.txt; then
  echo 'Android force-finished the GOVRP TWA at startup' >&2
  exit 1
fi
echo 'PASS: Android TWA launcher opened without uncaught application exception.'
