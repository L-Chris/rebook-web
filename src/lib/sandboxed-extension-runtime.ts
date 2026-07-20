import {
  createRebookExtensionSandboxBridge,
  type RebookDisposable,
  type RebookExtension,
  type RebookExtensionCatalogEntry,
  type RebookExtensionContext,
  type RebookExtensionSandboxBridge,
  type RebookExtensionSandboxEndpoint,
  type RebookExtensionSandboxMessage,
  type RebookExtensionSandboxRuntime,
} from 'rebook'
import { REBOOK_EXTENSION_SANDBOX_GUEST_SOURCE } from './extension-sandbox-guest'
import { createClientUUID } from './client-id'
import {
  fetchIntegrityPinnedExtensionArtifact,
  getSandboxedExtensionCacheKey,
} from './verified-extension-runtime'

type SandboxCommandResult = { value: unknown; settings?: Record<string, unknown> }
type SandboxInitializeResult = { commands?: string[]; settings?: Record<string, unknown> }

export interface BrowserExtensionSandboxRuntime extends RebookDisposable {
  readonly kind: RebookExtensionSandboxRuntime
  readonly manifest: RebookExtensionCatalogEntry['manifest']
  readonly frame: HTMLIFrameElement
  mount(container: HTMLElement, panelId: string): void
  unmount(): void
  executeCommand(id: string, args: readonly unknown[], settings: Record<string, unknown>): Promise<SandboxCommandResult>
  updateSettings(settings: Record<string, unknown>): Promise<void>
}

export { getSandboxedExtensionCacheKey }

export async function createSandboxedMarketplaceExtension(
  entry: RebookExtensionCatalogEntry,
): Promise<RebookExtension> {
  const sourceBytes = await fetchIntegrityPinnedExtensionArtifact(entry, 'sandbox')
  const source = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes)
  return {
    manifest: entry.manifest,
    async activate(context) {
      const runtime = await createBrowserSandboxRuntime(entry, source)
      try {
        const initialized = await runtime.initialize(readContextSettings(context))
        applySandboxSettings(context, initialized.settings)
        const registered = new Set(initialized.commands ?? [])
        for (const command of entry.manifest.contributes?.commands ?? []) {
          if (!registered.has(command.id)) continue
          context.commands.registerCommand(command.id, async (...args) => {
            const result = await runtime.executeCommand(command.id, args, readContextSettings(context))
            applySandboxSettings(context, result.settings)
            return result.value
          })
        }
        context.runtime.register(runtime)
        context.subscriptions.push({ dispose: () => runtime.dispose() })
      } catch (error) {
        runtime.dispose()
        throw error
      }
    },
  }
}

async function createBrowserSandboxRuntime(
  entry: RebookExtensionCatalogEntry,
  source: string,
): Promise<BrowserExtensionSandboxRuntime & { initialize(settings: Record<string, unknown>): Promise<SandboxInitializeResult> }> {
  const kind = entry.manifest.runtime?.kind
  if (kind !== 'worker' && kind !== 'iframe') throw new Error('Unsupported extension sandbox runtime.')
  const channel = `rebook:${entry.manifest.id}:${entry.manifest.version}:${createClientUUID()}`
  const endpoint = new BrowserSandboxEndpoint(kind, channel)
  const bridge = createRebookExtensionSandboxBridge(channel, endpoint, 15_000)
  try {
    const ready = waitForReady(bridge)
    endpoint.start()
    await ready
  } catch (error) {
    bridge.dispose()
    throw error
  }
  let disposed = false
  return {
    kind,
    manifest: entry.manifest,
    frame: endpoint.frame,
    async initialize(settings) {
      return bridge.request<SandboxInitializeResult>('initialize', {
        manifest: entry.manifest,
        settings,
        source,
        locale: document.documentElement.lang || navigator.language,
      }, { timeoutMs: 30_000 })
    },
    mount(container, panelId) {
      if (kind !== 'iframe') throw new Error('Only iframe extensions expose a mountable panel.')
      endpoint.frame.hidden = false
      endpoint.frame.className = 'h-full min-h-64 w-full border-0 bg-transparent'
      container.append(endpoint.frame)
      void bridge.request('showPanel', { id: panelId }).catch(() => undefined)
    },
    unmount() {
      endpoint.frame.hidden = true
      endpoint.frame.className = ''
      if (endpoint.frame.isConnected) document.body.append(endpoint.frame)
    },
    async executeCommand(id, args, settings) {
      return bridge.request<SandboxCommandResult>('executeCommand', { id, args: [...args], settings })
    },
    async updateSettings(settings) {
      await bridge.request('updateSettings', settings)
    },
    dispose() {
      if (disposed) return
      disposed = true
      void bridge.request('dispose', undefined, { timeoutMs: 1_000 }).catch(() => undefined).finally(() => bridge.dispose())
    },
  }
}

class BrowserSandboxEndpoint implements RebookExtensionSandboxEndpoint {
  readonly frame = document.createElement('iframe')
  private readonly listeners = new Set<(message: unknown) => void>()
  private readonly backlog: unknown[] = []
  private terminated = false
  private readonly receive = (event: MessageEvent) => {
    if (event.source !== this.frame.contentWindow) return
    if (!this.listeners.size) {
      this.backlog.push(event.data)
      return
    }
    for (const listener of this.listeners) listener(event.data)
  }

  constructor(kind: RebookExtensionSandboxRuntime, channel: string) {
    this.frame.sandbox.add('allow-scripts')
    this.frame.referrerPolicy = 'no-referrer'
    this.frame.title = `Rebook ${kind} extension sandbox`
    this.frame.hidden = true
    this.frame.setAttribute('aria-hidden', kind === 'worker' ? 'true' : 'false')
    this.frame.srcdoc = createSandboxDocument(kind, channel)
    window.addEventListener('message', this.receive)
  }

  start(): void {
    if (!this.frame.isConnected) document.body.append(this.frame)
  }

  postMessage(message: RebookExtensionSandboxMessage): void {
    if (this.terminated || !this.frame.contentWindow) throw new Error('Extension sandbox is unavailable.')
    this.frame.contentWindow.postMessage(message, '*')
  }

  subscribe(listener: (message: unknown) => void): RebookDisposable {
    this.listeners.add(listener)
    for (const message of this.backlog.splice(0)) listener(message)
    return { dispose: () => { this.listeners.delete(listener) } }
  }

  terminate(): void {
    if (this.terminated) return
    this.terminated = true
    window.removeEventListener('message', this.receive)
    this.listeners.clear()
    this.frame.remove()
  }
}

function createSandboxDocument(kind: RebookExtensionSandboxRuntime, channel: string): string {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' blob:",
    "worker-src blob:",
    "connect-src 'none'",
    "img-src data: blob:",
    "style-src 'unsafe-inline'",
    "font-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  const channelJSON = safeInlineJSON(channel)
  const bootstrap = createGuestBootstrap(channel)
  const guestSourceJSON = safeInlineJSON(bootstrap)
  const reportError = `const reportError=error=>parent.postMessage({protocol:1,channel:${channelJSON},type:'event',event:'sandbox.bootstrap-error',data:{message:String(error?.message||error),name:String(error?.name||'Error')}},'*');parent.postMessage({protocol:1,channel:${channelJSON},type:'event',event:'sandbox.document-ready'},'*');`
  const script = kind === 'worker'
    ? `${reportError}try{const workerURL=URL.createObjectURL(new Blob([${guestSourceJSON}],{type:'text/javascript'}));const worker=new Worker(workerURL);worker.onmessage=event=>parent.postMessage(event.data,'*');worker.onerror=event=>reportError(event.error||new Error(event.message||'Extension worker failed to start'));addEventListener('message',event=>{if(event.source===parent)worker.postMessage(event.data)});addEventListener('unload',()=>{worker.terminate();URL.revokeObjectURL(workerURL)});}catch(error){reportError(error)}`
    : `${reportError}addEventListener('error',event=>reportError(event.error||new Error(event.message||'Extension frame failed')));addEventListener('unhandledrejection',event=>reportError(event.reason));try{${bootstrap}}catch(error){reportError(error)}`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHTMLAttribute(csp)}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;min-height:100%;font:14px system-ui,sans-serif;color:#172033;background:transparent}</style></head><body><script type="module">${script}</script></body></html>`
}

function waitForReady(bridge: RebookExtensionSandboxBridge): Promise<void> {
  return new Promise((resolve, reject) => {
    let errorSubscription: RebookDisposable | undefined
    let documentSubscription: RebookDisposable | undefined
    let documentReady = false
    const timer = window.setTimeout(() => {
      subscription.dispose()
      errorSubscription?.dispose()
      documentSubscription?.dispose()
      reject(new Error(documentReady
        ? 'Extension sandbox document loaded, but its guest runtime did not become ready.'
        : 'Extension sandbox did not become ready.'))
    }, 10_000)
    const subscription = bridge.on('sandbox.ready', () => {
      window.clearTimeout(timer)
      subscription.dispose()
      errorSubscription?.dispose()
      documentSubscription?.dispose()
      resolve()
    })
    errorSubscription = bridge.on('sandbox.bootstrap-error', data => {
      window.clearTimeout(timer)
      subscription.dispose()
      errorSubscription?.dispose()
      documentSubscription?.dispose()
      const detail = data && typeof data === 'object' && 'message' in data
        ? String((data as { message?: unknown }).message || 'unknown error')
        : String(data || 'unknown error')
      reject(new Error(`Extension sandbox failed to start: ${detail}`))
    })
    documentSubscription = bridge.on('sandbox.document-ready', () => { documentReady = true })
  })
}

function createGuestBootstrap(channel: string): string {
  // Keep the native import expression inside a string so Vite cannot rewrite
  // it to a helper that is unavailable in the isolated realm.
  return `globalThis.__REBOOK_SANDBOX_CHANNEL__=${JSON.stringify(channel)};globalThis.__REBOOK_DYNAMIC_IMPORT__=url=>import(url);\n${REBOOK_EXTENSION_SANDBOX_GUEST_SOURCE}`
}

function readContextSettings(context: RebookExtensionContext): Record<string, unknown> {
  return Object.fromEntries(context.settings.list().map(setting => [setting.key, setting.effectiveValue]))
}

function applySandboxSettings(context: RebookExtensionContext, settings: Record<string, unknown> | undefined): void {
  if (!settings) return
  const declared = new Set(context.settings.list().map(setting => setting.key))
  for (const [key, value] of Object.entries(settings)) {
    if (declared.has(key)) context.settings.update(key, value)
  }
}

function safeInlineJSON(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

function escapeHTMLAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
