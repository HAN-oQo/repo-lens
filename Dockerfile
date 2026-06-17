# Repo Lens — self-hosted image (static build + OAuth server in one process).
#
# Build (for repolens.ce.moreh.dev):
#   docker build \
#     --build-arg BASE_PATH= \
#     --build-arg NEXT_PUBLIC_OAUTH_BASE=https://repolens.ce.moreh.dev \
#     -t repolens .
#
# Run (secrets at runtime, never baked):
#   docker run -p 8080:8080 \
#     -e GH_CLIENT_ID=xxx -e GH_CLIENT_SECRET=yyy \
#     -e ALLOWED_REDIRECTS=https://repolens.ce.moreh.dev,http://localhost:3000 \
#     repolens

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
# BASE_PATH="" → served at domain root (not /repo-lens). Both are build-time.
ARG BASE_PATH=""
ARG NEXT_PUBLIC_OAUTH_BASE=""
ENV BASE_PATH=$BASE_PATH
ENV NEXT_PUBLIC_OAUTH_BASE=$NEXT_PUBLIC_OAUTH_BASE
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production OUT_DIR=/app/out PORT=8080
COPY --from=build /app/out ./out
COPY --from=build /app/server ./server
EXPOSE 8080
CMD ["node", "server/server.mjs"]
