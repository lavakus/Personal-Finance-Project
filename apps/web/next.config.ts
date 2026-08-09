import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tradeos/types", "@tradeos/calculations"],
};

export default nextConfig;
