/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Headers that a future in-browser WASM prover (research track C) will need
  // for SharedArrayBuffer / threads. Harmless for the current server-proving app.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
