# Repo Lens v2 — self-hosted analysis backend for the CE-master CPU node.
# Static app + OAuth + clone/search/graphify/GraphRAG in one container.
#
# Build (node-local; app served at http://localhost:8080):
#   docker build \
#     --build-arg NEXT_PUBLIC_API_BASE=http://localhost:8080 \
#     --build-arg NEXT_PUBLIC_OAUTH_BASE=http://localhost:8080 \
#     -t repolens .
#
# Run (bind to localhost ONLY; reach via SSH tunnel). Secrets at runtime:
#   docker run -d --name repolens -p 127.0.0.1:8080:8080 -v repolens-data:/data \
#     -e GH_CLIENT_ID=… -e GH_CLIENT_SECRET=… \
#     -e ALLOWED_REDIRECTS=http://localhost:8080 \
#     -e ANTHROPIC_API_KEY=…   # or ASK_URL=https://askbot.ce.moreh.dev/ask \
#     repolens

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
ARG NEXT_PUBLIC_API_BASE=http://localhost:8080
ARG NEXT_PUBLIC_OAUTH_BASE=http://localhost:8080
ARG BASE_PATH=
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_OAUTH_BASE=$NEXT_PUBLIC_OAUTH_BASE
ENV BASE_PATH=$BASE_PATH
RUN npm run build

FROM node:20-bookworm-slim AS run
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep python3 python3-pip ca-certificates \
 && pip install --no-cache-dir --break-system-packages graphifyy \
 && apt-get purge -y python3-pip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production OUT_DIR=/app/out PORT=8080 DATA_DIR=/data CLONE_ALLOWED_HOSTS=github.com
COPY --from=build /app/out ./out
COPY --from=build /app/server ./server
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "server/server.mjs"]
