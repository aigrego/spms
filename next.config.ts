import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 部署：产出 .next/standalone（含 server.js），镜像只需拷贝该目录 + public + .next/static
  output: "standalone",
};

export default nextConfig;
