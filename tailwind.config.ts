import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0b0f",
        panel: "#13151c",
        panel2: "#1b1e27",
        border: "#272b36",
        muted: "#8a91a3",
        accent: "#5b8cff",
        accent2: "#7c5bff",
        ok: "#3ecf8e",
        warn: "#f5a623",
        danger: "#ff5b5b",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
