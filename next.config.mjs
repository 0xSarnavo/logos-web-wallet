/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produce a self-contained server bundle for a small Docker image.
  output: "standalone",
  // Keep native/server-only packages out of the webpack bundle (the argon2
  // native .node addon and pg must load at runtime, not be bundled).
  experimental: {
    serverComponentsExternalPackages: ["@node-rs/argon2", "pg"],
  },
  // Headers that a future in-browser WASM prover (research track C) will need
  // for SharedArrayBuffer / threads. Harmless for the current server-proving app.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          // Baseline security headers.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
