// HTML 1枚で配るためのビルド設定（npm run single から使う）
// ダブルクリックで開く file:// では、別ファイルの JS を読み込めない（ブラウザが止める）。
// そこで JS を1つにまとめ、tools/bundle-single.mjs で HTML の中に埋め込む。
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: process.env.SINGLE_OUT || "release/.single",
    emptyOutDir: true,
    assetsInlineLimit: 100000000,   // 画像なども全部埋め込む
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, "index.html"),
      output: { inlineDynamicImports: true, entryFileNames: "app.js", assetFileNames: "app.[ext]" },
    },
  },
});
