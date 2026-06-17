#!/usr/bin/env bash
# Repo Lens — single entrypoint for build / serve / deploy.
# Usage: scripts/repolens.sh {dev|build-pages|build-ce|serve|image|run|audit|help}
set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env if present (for serve/run/image).
if [ -f .env ]; then set -a; . ./.env; set +a; fi

OAUTH_BASE="${NEXT_PUBLIC_OAUTH_BASE:-https://repolens.ce.moreh.dev}"
IMAGE="${IMAGE:-repolens:latest}"
PORT="${PORT:-8080}"

case "${1:-help}" in
  dev)
    npm run dev ;;

  # Public demo build → ./out with basePath /repo-lens (what GitHub Pages CI runs).
  build-pages)
    npm ci --legacy-peer-deps
    npm run build ;;

  # Self-hosted build → ./out served at domain root, OAuth base baked in.
  build-ce)
    npm ci --legacy-peer-deps
    BASE_PATH= NEXT_PUBLIC_OAUTH_BASE="$OAUTH_BASE" npm run build ;;

  # Run the OAuth + static server over ./out (reads GH_CLIENT_ID/SECRET/ALLOWED_REDIRECTS from .env).
  serve)
    node server/server.mjs ;;

  # Build the container image for the CE deploy.
  image)
    docker build \
      --build-arg BASE_PATH= \
      --build-arg NEXT_PUBLIC_OAUTH_BASE="$OAUTH_BASE" \
      -t "$IMAGE" . ;;

  # Run the image locally (secrets from .env).
  run)
    docker run --rm -p "${PORT}:8080" \
      -e GH_CLIENT_ID -e GH_CLIENT_SECRET -e ALLOWED_REDIRECTS \
      "$IMAGE" ;;

  audit)
    npm audit --omit=dev || true ;;

  *)
    echo "usage: scripts/repolens.sh {dev|build-pages|build-ce|serve|image|run|audit}"
    echo "  dev          next dev (localhost:3000)"
    echo "  build-pages  static build for GitHub Pages (basePath /repo-lens)"
    echo "  build-ce     static build for repolens.ce.moreh.dev (root + OAuth baked)"
    echo "  serve        run server/server.mjs over ./out (+ OAuth)"
    echo "  image        docker build the CE image"
    echo "  run          docker run the CE image (env from .env)"
    echo "  audit        npm audit (prod deps)" ;;
esac
