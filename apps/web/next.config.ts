import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@tradeos/types",
    "@tradeos/calculations",
    "@tradeos/market-data",
  ],
};

export default nextConfig;
