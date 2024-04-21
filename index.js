import MagicString from 'magic-string'
import { URL, URLSearchParams } from 'node:url'
import path from 'node:path'

function toRelativePath(filename, importer) {
  const relPath = path.posix.relative(path.dirname(importer), filename)

  return relPath.startsWith('.') ? relPath : `./${relPath}`
}

function parseRequest(id) {
  const { search } = new URL(id, 'file:')
  if (!search) {
    return null
  }
  return Object.fromEntries(new URLSearchParams(search))
}

const queryRE = /\?.*$/s
const hashRE = /#.*$/s
const cleanUrl = (url) => url.replace(hashRE, '').replace(queryRE, '')

const nodeWorkerAssetUrlRE = /__VITE_NODE_WORKER_ASSET__([\w$]+)__/g

/**
 * Resolve `?nodeWorker` import and automatically generate `Worker` wrapper.
 */
export function workerPlugin() {
  let sourcemap = false
  return {
    name: 'vite:node-worker',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      sourcemap = config.build.sourcemap
    },
    resolveId(id, importer) {
      const query = parseRequest(id)
      if (query && typeof query.nodeWorker === 'string') {
        return id + `&importer=${importer}`
      }
    },
    load(id) {
      const query = parseRequest(id)
      if (query && typeof query.nodeWorker === 'string' && typeof query.importer === 'string') {
        const cleanPath = cleanUrl(id)
        const hash = this.emitFile({
          type: 'chunk',
          id: cleanPath,
          importer: query.importer
        })
        const assetRefId = `__VITE_NODE_WORKER_ASSET__${hash}__`

        return `
        import { Worker } from 'node:worker_threads';
        export default function (options) { return new Worker(new URL(${assetRefId}, import.meta.url), options); }`
      }
    },
    renderChunk(code, chunk) {
      if (code.match(nodeWorkerAssetUrlRE)) {
        let match
        const s = new MagicString(code)

        while ((match = nodeWorkerAssetUrlRE.exec(code))) {
          const [full, hash] = match
          const filename = this.getFileName(hash)
          const outputFilepath = toRelativePath(filename, chunk.fileName)
          const replacement = JSON.stringify(outputFilepath)
          s.overwrite(match.index, match.index + full.length, replacement, {
            contentOnly: true
          })
        }

        return {
          code: s.toString(),
          map: sourcemap ? s.generateMap({ hires: 'boundary' }) : null
        }
      }

      return null
    }
  }
}
