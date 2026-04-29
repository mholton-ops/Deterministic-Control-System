import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          950: "#05080d",
          900: "#0b1119",
          850: "#131c28",
          800: "#1a2734",
          700: "#2a3b4a",
          200: "#cfd8e2",
          100: "#e9edf2",
        },
        status: {
          good: "#6aa06a",
          warn: "#d9ad50",
          bad: "#c66d6d",
          info: "#6b8fb6",
        },
      },
      boxShadow: {
        panel: "0 12px 28px rgba(1, 5, 12, 0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
