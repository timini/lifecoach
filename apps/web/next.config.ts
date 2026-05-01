import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    // Allow importing TS from workspace packages without pre-build.
    externalDir: true,
  },
};

export default withNextIntl(config);
