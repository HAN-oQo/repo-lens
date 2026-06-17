import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Two deploy targets:
//  - GitHub Pages project page → basePath "/repo-lens" (the default in prod).
//  - Self-hosted at a domain root (repolens.ce.moreh.dev) → set BASE_PATH="" so
//    it serves from "/". BASE_PATH being *defined* (even empty) overrides the default.
const basePath =
  process.env.BASE_PATH !== undefined ? process.env.BASE_PATH : isProd ? "/repo-lens" : "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  assetPrefix: basePath ? basePath + "/" : undefined,
  images: { unoptimized: true },
};

export default nextConfig;
