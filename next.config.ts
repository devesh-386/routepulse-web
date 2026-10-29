import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // the control room used to live at /ops
  async redirects() {
    return [{ source: "/ops", destination: "/control-room", permanent: true }];
  },
};

export default nextConfig;
