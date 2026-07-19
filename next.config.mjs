/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    // OAuth discovery documents for MCP connectors (Claude/ChatGPT).
    // RFC 8414/9728 fix these paths at the origin root; the :path* suffix
    // covers clients that append the resource path to the well-known URL.
    return [
      { source: '/.well-known/oauth-authorization-server/:path*', destination: '/api/oauth/metadata' },
      { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth/metadata' },
      { source: '/.well-known/oauth-protected-resource/:path*', destination: '/api/oauth/protected-resource' },
      { source: '/.well-known/oauth-protected-resource', destination: '/api/oauth/protected-resource' },
    ]
  },
}

export default nextConfig
