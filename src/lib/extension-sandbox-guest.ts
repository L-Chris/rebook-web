/*
 * This function is serialized with Function#toString and executed inside an
 * opaque-origin sandbox document (or its Worker). Keep every dependency local.
 */
function rebookSandboxGuestMain(scope: any) {
  const protocol = 1
  const channel = String(scope.__REBOOK_SANDBOX_CHANNEL__ || '')
  const isFrame = Boolean(scope.parent && scope.parent !== scope)
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  let manifest: any = null
  let settings: Record<string, unknown> = {}
  let runtime: unknown
  let subscriptions: Array<{ dispose?(): void }> = []

  const send = (message: unknown) => {
    if (isFrame) scope.parent.postMessage(message, '*')
    else scope.postMessage(message)
  }
  const respond = (id: string, result?: unknown, error?: unknown) => send({
    protocol,
    channel,
    type: 'response',
    id,
    result: error ? undefined : result,
    error: error ? serializeError(error) : undefined,
  })
  const deny = (name: string) => () => { throw new Error(`${name} is unavailable inside the extension sandbox`) }
  const deniedGlobals: Array<[string, () => never]> = [
    ['fetch', deny('fetch')],
    ['WebSocket', deny('WebSocket')],
    ['EventSource', deny('EventSource')],
    ['XMLHttpRequest', deny('XMLHttpRequest')],
    ['importScripts', deny('importScripts')],
    ['open', deny('window.open')],
  ]
  for (const [name, replacement] of deniedGlobals) {
    try { Object.defineProperty(scope, name, { configurable: false, writable: false, value: replacement }) } catch {}
  }
  for (const name of ['indexedDB', 'caches']) {
    try { Object.defineProperty(scope, name, { configurable: false, get: deny(name) }) } catch {}
  }

  const methods: Record<string, (params: any) => unknown | Promise<unknown>> = {
    async initialize(params) {
      if (manifest) throw new Error('sandbox extension is already initialized')
      manifest = params.manifest
      settings = isPlainRecord(params.settings) ? { ...params.settings } : {}
      const source = String(params.source || '')
      if (!source) throw new Error('sandbox extension source is empty')
      const moduleURL = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      let moduleExports: any
      try {
        const importer = scope.__REBOOK_DYNAMIC_IMPORT__
        if (typeof importer !== 'function') throw new Error('sandbox module loader is unavailable')
        moduleExports = await importer(moduleURL)
      } finally {
        try { delete scope.__REBOOK_DYNAMIC_IMPORT__ } catch {}
        URL.revokeObjectURL(moduleURL)
      }
      const exported = moduleExports.default ?? moduleExports.extension ?? moduleExports.rebookExtension ?? null
      const candidate = typeof exported === 'function'
        ? await exported({ manifest, catalogEntry: { manifest }, installUrl: 'sandbox:' })
        : exported ?? moduleExports
      const runtimeManifest = candidate?.manifest ?? moduleExports.manifest
      if (runtimeManifest && (runtimeManifest.id !== manifest.id || runtimeManifest.version !== manifest.version)) {
        throw new Error('sandbox module manifest does not match the catalog')
      }
      const allowedCommands = new Set((manifest.contributes?.commands ?? []).map((item: any) => item.id))
      const context = {
        apiVersion: 1,
        extensionId: manifest.id,
        manifest,
        subscriptions,
        commands: {
          registerCommand(id: string, handler: (...args: unknown[]) => unknown) {
            if (!allowedCommands.has(id)) throw new Error(`command "${id}" is not declared in the manifest`)
            if (typeof handler !== 'function') throw new Error(`command "${id}" handler must be a function`)
            handlers.set(id, handler)
            const disposable = { dispose: () => { if (handlers.get(id) === handler) handlers.delete(id) } }
            subscriptions.push(disposable)
            return disposable
          },
          async executeCommand(id: string, ...args: unknown[]) {
            const handler = handlers.get(id)
            if (!handler) throw new Error(`command "${id}" is not registered`)
            return await handler(...args)
          },
          hasCommand(id: string) { return handlers.has(id) },
          listCommands() { return [...handlers.keys()].map(id => ({ id, extensionId: manifest.id, manifest })) },
        },
        settings: createSettingsService(),
        runtime: {
          register(value: unknown) {
            runtime = value
            const disposable = { dispose: () => { if (runtime === value) runtime = undefined } }
            subscriptions.push(disposable)
            return disposable
          },
          get() { return runtime },
        },
      }
      const activated = await candidate?.activate?.(context)
      if (activated !== undefined) throw new Error('sandbox extensions cannot return host book-transform plugins')
      return { commands: [...handlers.keys()], settings }
    },
    async executeCommand(params) {
      if (isPlainRecord(params.settings)) settings = { ...params.settings }
      const handler = handlers.get(String(params.id || ''))
      if (!handler) throw new Error(`command "${String(params.id)}" is not registered`)
      const args = Array.isArray(params.args) ? params.args : []
      return { value: await handler(...args), settings }
    },
    updateSettings(params) {
      settings = isPlainRecord(params) ? { ...params } : {}
      return { settings }
    },
    async showPanel(params) {
      const panelId = String(params?.id || '')
      const declared = (manifest?.contributes?.panels ?? []).some((panel: any) => panel.id === panelId)
      if (!declared) throw new Error(`panel "${panelId}" is not declared`)
      if (runtime && typeof (runtime as any).showPanel === 'function') await (runtime as any).showPanel(panelId)
      if (scope.document?.body) scope.document.body.dataset.rebookPanel = panelId
      return { ok: true }
    },
    dispose() {
      for (const subscription of subscriptions.splice(0).reverse()) {
        try { subscription.dispose?.() } catch {}
      }
      handlers.clear()
      manifest = null
      settings = {}
      runtime = undefined
      return { ok: true }
    },
  }

  function createSettingsService() {
    const contributions = manifest?.contributes?.settings ?? {}
    return {
      get(key: string, fallback?: unknown) {
        if (Object.prototype.hasOwnProperty.call(settings, key)) return settings[key]
        if (Object.prototype.hasOwnProperty.call(contributions[key] ?? {}, 'default')) return contributions[key].default
        return fallback
      },
      update(key: string, value: unknown) {
        if (!Object.prototype.hasOwnProperty.call(contributions, key)) throw new Error(`setting "${key}" is not declared`)
        settings[key] = value
      },
      inspect(key: string) {
        const contribution = contributions[key]
        const value = Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : undefined
        const defaultValue = contribution?.default
        return { extensionId: manifest.id, key, manifest, contribution, value, defaultValue, effectiveValue: value ?? defaultValue }
      },
      list() { return Object.keys(contributions).map(key => this.inspect(key)) },
    }
  }

  function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value))
  }

  function serializeError(value: unknown) {
    const error: any = value instanceof Error ? value : new Error(String(value))
    return { name: error.name || 'Error', message: error.message || 'Sandbox request failed', code: typeof error.code === 'string' ? error.code : undefined }
  }

  scope.addEventListener('message', (event: MessageEvent) => {
    const message = event.data
    if (!message || message.protocol !== protocol || message.channel !== channel || message.type !== 'request') return
    const method = methods[message.method]
    if (!method) {
      respond(message.id, undefined, new Error(`sandbox method "${message.method}" is unavailable`))
      return
    }
    Promise.resolve(method(message.params)).then(
      result => respond(message.id, result),
      error => respond(message.id, undefined, error),
    )
  })
  send({ protocol, channel, type: 'event', event: 'sandbox.ready' })
}

export const REBOOK_EXTENSION_SANDBOX_GUEST_SOURCE = `(${rebookSandboxGuestMain.toString()})(globalThis);`
