# Repo Lens on the CE cluster — the askbot pattern (ce.moreh.dev)

This mirrors **moreh-dev/ce-training `server/k8s/40-askbot.yaml`**, not the blog's
nginx/oauth2-proxy. Repo Lens is an XHR app with its own GitHub login + an
`AUTH_REQUIRED` gate, so — exactly like the askbot widget — it self-gates and must
**not** sit behind an interactive Google oauth2-proxy (that would break `/api`
XHR and the `/gh/callback` flow).

```
public edge 1.249.213.127      ← terminates TLS for *.ce.moreh.dev (SRE-managed)
  │ http (Host: repolens.ce.moreh.dev)
  ▼
istio public-gw :80            ← istio-system/public-gw (shared Gateway API gw)
  │ HTTPRoute repolens  (forces X-Forwarded-Proto: https, request timeout 0s)
  ▼
repolens-origin Service (selector-less) ─► EndpointSlice ─► ce-master 192.168.2.20:8080
                                                            └─ host systemd service
                                                               (deploy/repolens.service)
```

Consequences: **no image registry** (the image is built locally on the node and run
by systemd — nothing is pushed), **no cert-manager / TLS Secret** (TLS terminates at
the edge), **no Ingress** (Gateway API HTTPRoute on the shared gw). The cluster only
holds Service + EndpointSlice + HTTPRoute.

## 1. Run the server on the host (the actual workload)
See `../../DEPLOY.md` / the HTML runbook (`docs/repo-lens-ce-deploy.html`). In short,
on ce-master:
```bash
sudo mkdir -p /srv/repolens/data && sudo chown -R $USER /srv/repolens
git clone https://github.com/HAN-oQo/repo-lens /srv/repolens/repo && cd /srv/repolens/repo
docker build -t repolens:latest \
  --build-arg NEXT_PUBLIC_API_BASE=https://repolens.ce.moreh.dev \
  --build-arg NEXT_PUBLIC_OAUTH_BASE=https://repolens.ce.moreh.dev .
# fill /srv/repolens/repolens.env (GH_CLIENT_ID/SECRET, AUTH_REQUIRED=1, ASK_URL or ANTHROPIC_API_KEY)
sudo cp deploy/repolens.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now repolens
curl -s localhost:8080/healthz   # → ok
```

## 2. Expose it publicly (this directory)
```bash
deploy/k8s/apply.sh                                  # idempotent; runs on ce-master
# equivalently:
export KUBECONFIG=/etc/kubernetes/admin.conf
sudo -E kubectl apply -f deploy/k8s/repolens.yaml    # ns + Service + EndpointSlice + HTTPRoute
```
Verify: `curl -s https://repolens.ce.moreh.dev/healthz` → `ok`; an unauthenticated
`/api/*` call returns 401.

## Notes
- **Node IP** `192.168.2.20` in the EndpointSlice = ce-master (same endpoint askbot
  uses). If it differs, `kubectl get node -o wide` and update `repolens.yaml`.
- **Strict private (no public route):** bind `repolens.service` to `127.0.0.1:8080`
  and skip step 2 — reach it via `ssh -L 8080:localhost:8080 ce-master`.
- **Take down public access** without stopping the server:
  `sudo -E kubectl -n repo-lens delete httproute repolens`.
- The public-gw already accepts cross-namespace routes (ce-blog's route lives in the
  `ce-blog` ns and attaches to `istio-system/public-gw`), so the `repo-lens` ns works
  the same. If the Gateway restricts `allowedRoutes` by namespace label, label this ns
  to match.
