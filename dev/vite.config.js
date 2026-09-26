import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  base: "./", // Electronのfile://読み込みに必要
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        mobile: resolve(__dirname, "mobile.html"),
      },
    },
  },
});
