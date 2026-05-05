#!/bin/sh
set -eu

WORK_DIR="/zap/wrk"
OPENAPI_SOURCE="$WORK_DIR/openapi.json"
OPENAPI_RUNTIME="$WORK_DIR/.zap/openapi.generated.json"
AUTH_OPTIONS="$WORK_DIR/.zap/auth-header.prop"
REPORT_DIR="$WORK_DIR/reports"

mkdir -p "$WORK_DIR/.zap" "$REPORT_DIR"

python3 - <<'PY'
import json
import os

source = "/zap/wrk/openapi.json"
target = "/zap/wrk/.zap/openapi.generated.json"
base_url = os.environ.get("ZAP_TARGET_BASE_URL", "http://backend:3001").rstrip("/")

with open(source, encoding="utf-8") as fh:
    spec = json.load(fh)

spec["servers"] = [{"url": base_url}]

with open(target, "w", encoding="utf-8") as fh:
    json.dump(spec, fh, indent=2)
    fh.write("\n")
PY

set -- zap-api-scan.py \
  -t "$OPENAPI_RUNTIME" \
  -f openapi \
  -c "$WORK_DIR/zap-api-rules.conf" \
  -r "$REPORT_DIR/zap-api-report.html" \
  -J "$REPORT_DIR/zap-api-report.json" \
  -w "$REPORT_DIR/zap-api-report.md" \
  -x "$REPORT_DIR/zap-api-report.xml" \
  -T "${ZAP_MAX_WAIT_MINUTES:-5}"

case "${ZAP_FAIL_ON_WARNINGS:-false}" in
  true|TRUE|1|yes|YES|on|ON) ;;
  *) set -- "$@" -I ;;
esac

case "${ZAP_SAFE_MODE:-false}" in
  true|TRUE|1|yes|YES|on|ON) set -- "$@" -S ;;
esac

case "${ZAP_DEBUG:-false}" in
  true|TRUE|1|yes|YES|on|ON) set -- "$@" -d ;;
esac

case "${ZAP_INCLUDE_ALPHA:-false}" in
  true|TRUE|1|yes|YES|on|ON) set -- "$@" -a ;;
esac

if [ -n "${ZAP_AUTH_TOKEN:-}" ]; then
  {
    printf '%s\n' 'replacer.full_list(0).description=AuthorizationBearer'
    printf '%s\n' 'replacer.full_list(0).enabled=true'
    printf '%s\n' 'replacer.full_list(0).matchtype=REQ_HEADER'
    printf '%s\n' 'replacer.full_list(0).matchstr=Authorization'
    printf '%s\n' 'replacer.full_list(0).regex=false'
    printf 'replacer.full_list(0).replacement=Bearer %s\n' "$ZAP_AUTH_TOKEN"
  } > "$AUTH_OPTIONS"
  set -- "$@" -z "-configfile $AUTH_OPTIONS"
else
  echo "[security] Sin ZAP_AUTH_TOKEN: los endpoints protegidos se validaran como no autenticados."
fi

echo "[security] Ejecutando OWASP ZAP API Scan contra ${ZAP_TARGET_BASE_URL:-http://backend:3001}"
exec "$@"
