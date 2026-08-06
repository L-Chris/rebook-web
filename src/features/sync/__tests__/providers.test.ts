import { describe, expect, it } from 'vitest'

import {
  SYNC_PROVIDER_PRESETS,
  createDefaultSyncSettings,
  normalizeSyncSettings,
  selectSyncProvider,
  syncProviderPreset,
  validateSyncSettings,
} from '../providers'

describe('provider presets', () => {
  it('matches the documented endpoints and proxy prefixes', () => {
    const byKind = Object.fromEntries(SYNC_PROVIDER_PRESETS.map(preset => [preset.kind, preset]))
    expect(byKind.jianguoyun).toMatchObject({
      baseUrl: 'https://dav.jianguoyun.com/dav',
      proxyPrefix: 'https://webdav-proxy.torto.deno.net',
    })
    expect(byKind.infinicloud.baseUrl).toBe('https://webdav.infini-cloud.net')
    expect(byKind.koofr.baseUrl).toBe('https://app.koofr.net/dav/Koofr')
    expect(byKind.hidrive.baseUrl).toBe('https://webdav.hidrive.strato.com')
    expect(byKind.yandex.baseUrl).toBe('https://webdav.yandex.com')
    for (const kind of ['infinicloud', 'koofr', 'hidrive', 'yandex']) {
      expect(byKind[kind].proxyPrefix).toBe('https://torto-webdav-proxy.rethinkos.workers.dev')
    }
    expect(byKind.custom).toMatchObject({ baseUrl: null, proxyPrefix: '' })
  })

  it('prefills endpoint fields when switching providers', () => {
    const settings = createDefaultSyncSettings()
    const jianguoyun = selectSyncProvider(settings, 'jianguoyun')
    expect(jianguoyun.baseUrl).toBe('https://dav.jianguoyun.com/dav')
    expect(jianguoyun.proxyPrefix).toBe('https://webdav-proxy.torto.deno.net')
  })
})

describe('settings validation', () => {
  it('accepts a complete preset configuration', () => {
    const settings = normalizeSyncSettings({
      ...createDefaultSyncSettings(),
      enabled: true,
      username: 'reader',
      password: 'secret',
    })
    expect(() => validateSyncSettings(settings)).not.toThrow()
  })

  it('rejects plain HTTP for remote hosts but allows localhost', () => {
    const base = {
      ...createDefaultSyncSettings(),
      provider: 'custom' as const,
      username: 'reader',
      password: 'secret',
      proxyPrefix: '',
    }
    expect(() => validateSyncSettings({ ...base, baseUrl: 'http://dav.example.com' })).toThrow()
    expect(() => validateSyncSettings({ ...base, baseUrl: 'http://127.0.0.1:9080' })).not.toThrow()
  })

  it('requires username, password and a UUID device id', () => {
    const preset = syncProviderPreset('jianguoyun')
    const base = {
      ...createDefaultSyncSettings(),
      baseUrl: preset.baseUrl!,
      proxyPrefix: preset.proxyPrefix,
      username: 'reader',
      password: 'secret',
    }
    expect(() => validateSyncSettings({ ...base, username: '' })).toThrow()
    expect(() => validateSyncSettings({ ...base, password: '' })).toThrow()
    expect(() => validateSyncSettings({ ...base, deviceId: 'not-a-uuid' })).toThrow()
  })
})
