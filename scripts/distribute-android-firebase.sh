#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT_DIR/.env"
  set +a
fi

APK_PATH="${APK_PATH:-"$ROOT_DIR/builds/hogyeong-crew-android-release.apk"}"
FIREBASE_TOOLS_VERSION="${FIREBASE_TOOLS_VERSION:-15.22.0}"
RELEASE_NOTES="${RELEASE_NOTES:-덩산 Android 테스트 빌드}"

if [[ ! -f "$APK_PATH" ]]; then
  echo "APK not found: $APK_PATH" >&2
  echo "Build it first, then rerun this script." >&2
  exit 1
fi

if [[ -z "${FIREBASE_ANDROID_APP_ID:-}" ]]; then
  echo "FIREBASE_ANDROID_APP_ID is required." >&2
  echo "Find it in Firebase Console > Project settings > Your apps > Android app > App ID." >&2
  exit 1
fi

args=(
  "appdistribution:distribute"
  "$APK_PATH"
  "--app"
  "$FIREBASE_ANDROID_APP_ID"
  "--release-notes"
  "$RELEASE_NOTES"
)

if [[ -n "${FIREBASE_PROJECT_ID:-}" ]]; then
  args+=("--project" "$FIREBASE_PROJECT_ID")
fi

if [[ -n "${FIREBASE_TESTER_GROUPS:-}" ]]; then
  args+=("--groups" "$FIREBASE_TESTER_GROUPS")
fi

if [[ -n "${FIREBASE_TESTERS:-}" ]]; then
  args+=("--testers" "$FIREBASE_TESTERS")
fi

cd "$ROOT_DIR"
exec npx --yes "firebase-tools@$FIREBASE_TOOLS_VERSION" "${args[@]}"
