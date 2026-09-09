#!/usr/bin/env bash
#
# Builds the Tradosphere Android shell.
#
#   TRADOSPHERE_APP_URL=https://your-host ./scripts/android-build.sh
#
# The shell is a native WebView pointed at a deployed Tradosphere host — the
# app is server-rendered, so there is nothing to bundle and, deliberately,
# nothing to extract: the APK carries no Supabase keys, no provider
# credentials and no market data. Everything stays behind the same
# authenticated, RLS-governed backend the web app uses.
#
# The host is required rather than defaulted because an APK built against a
# placeholder installs and launches happily, and only fails once it is on a
# real phone in someone else's hands.
#
# Produces a DEBUG apk, which is signed with the shared Android debug key and
# is for testing only. Release signing needs a keystore that must not live in
# this repository — see README.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -z "${TRADOSPHERE_APP_URL:-}" ]; then
  echo "TRADOSPHERE_APP_URL is required, e.g. https://tradosphere.example.com" >&2
  exit 1
fi

# The Android Gradle plugin needs a real JDK and the SDK. Honour whatever the
# environment already provides; fall back to the Homebrew locations.
export JAVA_HOME="${JAVA_HOME:-$(brew --prefix openjdk@21 2>/dev/null)/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$PATH"

if [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "No JDK at JAVA_HOME=$JAVA_HOME (try: brew install openjdk@21)" >&2
  exit 1
fi
if [ ! -d "$ANDROID_HOME/platforms" ]; then
  echo "No Android SDK at ANDROID_HOME=$ANDROID_HOME" >&2
  echo "Try: brew install --cask android-commandlinetools" >&2
  exit 1
fi

echo "sdk.dir=$ANDROID_HOME" > android/local.properties

echo "==> syncing capacitor against $TRADOSPHERE_APP_URL"
npx cap sync android

echo "==> assembling debug apk"
(cd android && ./gradlew --no-daemon assembleDebug)

echo
echo "APK: android/app/build/outputs/apk/debug/app-debug.apk"
