import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

// Versão vinda do package.json. Estava escrita à mão no src/index.js e ficou
// para trás no bump para 0.1.1 — o pacote publicado se dizia 0.1.0.
const { version } = JSON.parse(readFileSync('./package.json', 'utf8'))

// Build do SDK (o que vai para o npm/CDN).
// Alvo: bundle único, sem dependências, ~15 KB. Todo o peso do webphone
// (libwebphone.js + popup.js) fica no HOST, carregado sob demanda no iframe.
export default defineConfig({
  define: { __BP_VERSION__: JSON.stringify(version) },
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
    // 'hidden' gera os .map (úteis para depurar aqui) mas NÃO escreve o
    // comentário sourceMappingURL nos bundles. Como os .map ficam fora do
    // tarball, a referência viraria um 404 no devtools do integrador.
    sourcemap: 'hidden',
    target: 'es2018',
  },
})
