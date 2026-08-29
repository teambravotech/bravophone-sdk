import { defineConfig } from 'vite'

// Build do SDK (o que vai para o npm/CDN).
// Alvo: bundle único, sem dependências, ~15 KB. Todo o peso do webphone
// (libwebphone.js + popup.js) fica no HOST, carregado sob demanda no iframe.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.js',
      name: 'Bravophone',
      fileName: 'bravophone',
      formats: ['es', 'umd'],
    },
    // exports:'default' faz o UMD atribuir a API direto em window.Bravophone.
    // Sem isso a global vira o namespace do módulo e o consumidor via <script>
    // precisaria escrever Bravophone.default.call(...) — armadilha silenciosa.
    rollupOptions: { output: { exports: 'default' } },
    minify: 'esbuild',
    sourcemap: true,
    target: 'es2018',
  },
})
