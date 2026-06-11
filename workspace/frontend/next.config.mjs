/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async redirects() {
    return [
      {
        source: '/',
        has: [{ type: 'host', value: 'workspace.openagents.org' }],
        destination: 'https://openagents.org/workspace',
        permanent: true,
      },
      {
        source: '/install.sh',
        destination: 'https://raw.githubusercontent.com/openagents-org/openagents/develop/scripts/install.sh',
        permanent: false,
      },
      {
        source: '/install.ps1',
        destination: 'https://raw.githubusercontent.com/openagents-org/openagents/develop/scripts/install.ps1',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/wsapi/:path*',
        destination: 'https://workspace-endpoint.openagents.org/:path*',
      },
    ];
  },
};

export default nextConfig;
