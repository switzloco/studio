
import type {NextConfig} from 'next';
import { execSync } from 'child_process';

let buildId = 'dev';
try {
  buildId = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // Not in a git repo or git not available
}

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
