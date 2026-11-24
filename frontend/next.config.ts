import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: `next build` writes plain HTML/JS to out/, which the FastAPI backend serves
  // (and Vercel hosts as a static site). trailingSlash emits route/index.html, the layout
  // Starlette's StaticFiles(html=True) serves without extra routing.
  output: "export",
  trailingSlash: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
