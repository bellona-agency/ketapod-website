import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Same reason as web/: the container ships the server and its traced
     dependencies rather than the whole node_modules tree. Inert outside
     Docker. */
  output: "standalone",
};

export default nextConfig;
