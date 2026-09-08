import type { Config } from "tailwindcss";

// Monochrome: dark grey + white. Solid colors, no gradients.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0e0e10", // page
        panel: "#16161a", // card
        panel2: "#1f1f24", // inputs / inner surfaces
        border: "#2c2c32",
        muted: "#8c8c94", // secondary text
        accent: "#f2f2f4", // near-white (titles, highlights)
        accent2: "#b6b6be", // light grey (private accents)
        ok: "#f2f2f4", // balances (white)
        warn: "#c9c9cf",
        danger: "#e39a9a", // soft solid red — errors only
      },
      borderRadius: {
        lg: "0.625rem",
        xl: "0.875rem",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
