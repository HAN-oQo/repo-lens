# Repo Lens on the CE cluster (ce.moreh.dev, like ce-blog)

v2 is a single container (the `Dockerfile`). It runs on your CE cluster the same way
ce-blog / askbot do: build → push → Deployment + Service + Ingress for
`repolens.ce.moreh.dev`. Free (your infra). Login-gated (`AUTH_REQUIRED=1`) so only
signed-in GitHub users can use it even though the host is reachable.

## Prerequisites (one-time, you provide)
1. **DNS:** `repolens.ce.moreh.dev` → the CE edge (A/CNAME on Cloudflare, like askbot).
2. **OAuth App:** callback `https://repolens.ce.moreh.dev/gh/callback`, homepage
   `https://repolens.ce.moreh.dev`. Copy Client ID + secret into the Secret.
3. **Registry** your cluster can pull from.

## Deploy
```bash
# 1) build with the public host baked in, push
docker build \
  --build-arg NEXT_PUBLIC_API_BASE=https://repolens.ce.moreh.dev \
  --build-arg NEXT_PUBLIC_OAUTH_BASE=https://repolens.ce.moreh.dev \
  -t <REGISTRY>/repolens:latest .
docker push <REGISTRY>/repolens:latest

# 2) fill the «PLACEHOLDERS» in repolens.yaml (namespace, ingress class, TLS issuer,
#    registry, secret values) to match ce-blog, then:
kubectl apply -f deploy/k8s/repolens.yaml
```

## Argo CD (gitops, like your argocd-gitops-lab)
Add an Application pointing at this path:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata: { name: repolens, namespace: argocd }
spec:
  project: default
  source: { repoURL: https://github.com/HAN-oQo/repo-lens.git, targetRevision: main, path: deploy/k8s }
  destination: { server: https://kubernetes.default.svc, namespace: <NAMESPACE> }
  syncPolicy: { automated: { prune: true, selfHeal: true } }
```

## To match ce-blog exactly
The placeholders (ingress class, TLS annotations, namespace) should mirror ce-blog's
own manifest. Point me at that manifest (or paste it) and I'll fill them in precisely.
