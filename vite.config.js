const { defineConfig } = require("vite");
const path = require("node:path");

module.exports = defineConfig({
  root: path.resolve(__dirname, "public"),
  publicDir: false,
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
