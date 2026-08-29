import { defineConfig } from 'vite'

// Servidor de desenvolvimento do HOST (o webphone embutido).
// O host é HTML + assets estáticos: não há bundling, o Vite aqui só serve
// os arquivos com os headers corretos para testar o embed localmente.
export default defineConfig({
  root: 'host',
  server: {
    port: 5174,
    headers: {
      // Em produção esta lista sai do allowlist dinâmico (ver README).
      'Content-Security-Policy':
        "frame-ancestors 'self' http://localhost:* https://*.bravophone.com;",
      'Permissions-Policy': 'microphone=(self)',
    },
  },
  build: { outDir: '../dist-host', emptyOutDir: true },
})
