import type { NextConfig } from 'next';

const customDistDir =
  process.env.VERCEL === '1' ? undefined : process.env.HAPOS_DIST_DIR;
const useStaticExport = process.env.HAPOS_STATIC_EXPORT === '1';

const nextConfig: NextConfig = {
  ...(customDistDir
    ? {
        distDir: customDistDir,
      }
    : useStaticExport
      ? {
          distDir: 'out',
        }
      : {}),
  
  // ⚡ Add this for static export (needed by Capacitor)
  ...(useStaticExport
    ? {
        // Static export is only valid for explicitly offline packaging flows.
        output: 'export',
      }
    : {}),

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
