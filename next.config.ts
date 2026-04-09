import type { NextConfig } from 'next';

const customDistDir =
  process.env.VERCEL === '1' ? undefined : process.env.HAPOS_DIST_DIR;

const nextConfig: NextConfig = {
  ...(customDistDir
    ? {
        distDir: customDistDir,
      }
    : {}),
  
  // ⚡ Add this for static export (needed by Capacitor)
  output: 'export',       // replaces `next export`
  distDir: 'out',         // ensure static output goes to 'out' folder

  experimental: {
    cpus: 1,
    workerThreads: true,
    webpackBuildWorker: false,
  },
  
  ...(process.env.HAPOS_SKIP_BUILD_CHECKS
    ? {
        typescript: {
          ignoreBuildErrors: true,
        },
      }
    : {}),
};

export default nextConfig;