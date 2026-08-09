import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@tradeos/types",
    "@tradeos/calculations",
    "@tradeos/market-data",
    "@tradeos/news",
  ],
};

export default nextConfig;
