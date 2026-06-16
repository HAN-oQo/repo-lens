import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Deployed as a GitHub Pages project page at https://han-oqo.github.io/repo-lens
// so we need basePath/assetPrefix in production. In dev (localhost:3000) keep them empty.
const nextConfig: NextConfig = {
  output: "export",
  basePath: isProd ? "/repo-lens" : "",
  assetPrefix: isProd ? "/repo-lens/" : "",
  images: { unoptimized: true },
};

export default nextConfig;
