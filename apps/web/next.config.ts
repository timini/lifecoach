import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    // Allow importing TS from workspace packages without pre-build.
    externalDir: true,
  },
};

export default config;
