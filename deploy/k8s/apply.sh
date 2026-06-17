#!/usr/bin/env bash
# apply.sh — expose the Repo Lens host service publicly (ns repo-lens), the same
# way moreh-dev/ce-training's server/k8s/apply.sh exposes the blog/askbot.
# Idempotent: safe to re-run. Run on ce-master (cluster admin).
#
#   namespace -> repolens-origin Service + EndpointSlice (-> ce-master :8080)
#   -> HTTPRoute (repolens.ce.moreh.dev on istio-system/public-gw)
#
# This only wires the public route. The actual server runs as a HOST systemd
# service (deploy/repolens.service) — start that first (see DEPLOY.md):
#   sudo cp deploy/repolens.service /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now repolens
#
# kubectl: defaults to `sudo -E kubectl` with the node admin kubeconfig (what
# ce-master needs). Override e.g. KUBECTL="kubectl" ./apply.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
export KUBECONFIG="${KUBECONFIG:-/etc/kubernetes/admin.conf}"
KUBECTL="${KUBECTL:-sudo -E kubectl}"
K(){ $KUBECTL "$@"; }

# Namespace + Service + EndpointSlice + HTTPRoute (HTTPRoute last — that's what
# makes it public). All in one file; apply is order-independent here.
K apply -f "$HERE/repolens.yaml"

# Report
echo "applied. node endpoint:"
K -n repo-lens get endpointslice repolens-origin-1 -o jsonpath='{.endpoints[0].addresses[0]}:{.ports[0].port}{"\n"}'
echo "route:"
K -n repo-lens get httproute repolens -o jsonpath='{.spec.hostnames[0]}{"\n"}'
echo "done — https://repolens.ce.moreh.dev (GitHub login, AUTH_REQUIRED=1)"
echo "verify (unauth API call should 401):"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://repolens.ce.moreh.dev/api/status?repo=x"
