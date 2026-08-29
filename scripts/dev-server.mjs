#!/usr/bin/env node
/**
 * dev-server.mjs — sobe duas origens locais, sem dependências.
 *
 *   :5173  site do cliente  → examples/test.html
 *   :5174  host do webphone → host/mock.html
 *
 * Duas portas de propósito: origens diferentes fazem o teste exercitar o
 * postMessage cross-origin de verdade, incluindo a validação de origem.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
}

function serve({ port, root, index, headers = {}, label }) {
  const base = resolve(ROOT, root)

  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      if (path === '/' || path === '') path = '/' + index

      // Impede path traversal: o alvo resolvido tem de continuar sob a raiz.
      const target = resolve(base, '.' + normalize(path))
      if (target !== base && !target.startsWith(base + sep)) {
        res.writeHead(403).end('403')
        return
      }

      const info = await stat(target).catch(() => null)
      if (!info || !info.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('404: ' + path)
        return
      }

      const body = await readFile(target)
      res.writeHead(200, {
        'content-type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
        ...headers,
      })
      res.end(body)
    } catch (err) {
      res.writeHead(500).end('500: ' + err.message)
    }
  })

  return new Promise((ok) => server.listen(port, () => {
    console.log(`  ${label.padEnd(16)} http://localhost:${port}/`)
    ok(server)
  }))
}

console.log('\nBravophone SDK — servidores de teste\n')

await serve({
  port: 5173,
  root: '.',
  index: 'examples/test.html',
  label: 'site cliente',
})

await serve({
  port: 5174,
  root: 'host',
  index: 'mock.html',
  label: 'host webphone',
  headers: {
    // Mesmos headers que a produção precisa emitir.
    'content-security-policy': "frame-ancestors 'self' http://localhost:5173;",
    'permissions-policy': 'microphone=(self)',
  },
})

console.log('\n→ Abra  http://localhost:5173/\n')
console.log('  Ctrl+C para parar.\n')
