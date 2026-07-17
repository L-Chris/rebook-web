import type { RendererFontFamilies } from 'rebook'

export type ReaderDefaultFont = 'serif' | 'sans-serif'

export interface ReaderFontSettings {
  defaultFont: ReaderDefaultFont
  defaultCJKFont: string
  serifFont: string
  sansSerifFont: string
  monospaceFont: string
}

export const READER_FONT_DEFAULTS: ReaderFontSettings = {
  defaultFont: 'serif',
  defaultCJKFont: 'LXGW WenKai GB Screen',
  serifFont: 'Bitter',
  sansSerifFont: 'Roboto',
  monospaceFont: 'Fira Code',
}

export const SERIF_FONT_OPTIONS = [
  ['Bitter', 'Bitter'],
  ['Literata', 'Literata'],
  ['Merriweather', 'Merriweather'],
  ['Noto Serif', 'Noto Serif'],
] satisfies Array<[string, string]>

export const SANS_SERIF_FONT_OPTIONS = [
  ['Roboto', 'Roboto'],
  ['Noto Sans', 'Noto Sans'],
  ['Open Sans', 'Open Sans'],
  ['Inter', 'Inter'],
] satisfies Array<[string, string]>

export const MONOSPACE_FONT_OPTIONS = [
  ['Fira Code', 'Fira Code'],
  ['Roboto Mono', 'Roboto Mono'],
  ['IBM Plex Mono', 'IBM Plex Mono'],
] satisfies Array<[string, string]>

export const CJK_FONT_OPTIONS = [
  ['LXGW WenKai GB Screen', '霞鹜文楷'],
  ['Noto Serif SC', '思源宋体'],
  ['Noto Sans SC', '思源黑体'],
  ['MiSans L3', 'MiSans'],
] satisfies Array<[string, string]>

const GOOGLE_FONT_QUERIES: Record<string, string> = {
  Bitter: 'Bitter:ital,wght@0,400..900;1,400..900',
  Literata: 'Literata:ital,opsz,wght@0,7..72,400..900;1,7..72,400..900',
  Merriweather: 'Merriweather:ital,opsz,wght@0,18..144,400..900;1,18..144,400..900',
  'Noto Serif': 'Noto Serif:ital,wght@0,400..900;1,400..900',
  Roboto: 'Roboto:ital,wght@0,400..900;1,400..900',
  'Noto Sans': 'Noto Sans:ital,wght@0,400..900;1,400..900',
  'Open Sans': 'Open Sans:ital,wght@0,400..800;1,400..800',
  Inter: 'Inter:ital,wght@0,400..900;1,400..900',
  'Fira Code': 'Fira Code:wght@400..700',
  'Roboto Mono': 'Roboto Mono:ital,wght@0,400..700;1,400..700',
  'IBM Plex Mono': 'IBM Plex Mono:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700',
  'Noto Serif SC': 'Noto Serif SC:wght@400;500;600;700',
  'Noto Sans SC': 'Noto Sans SC:wght@400;500;600;700',
}

const FONT_STYLESHEETS: Record<string, string> = {
  'LXGW WenKai GB Screen': 'https://cdnjs.cloudflare.com/ajax/libs/lxgw-wenkai-screen-web/1.520.0/lxgwwenkaigbscreen/result.css',
  'MiSans L3': 'https://cdn.jsdelivr.net/npm/misans-webfont@1.0.4/misans-l3/misans-l3/result.min.css',
}

const stylesheetLoads = new Map<string, Promise<void>>()

export function getReaderFontFamilies(settings: ReaderFontSettings): RendererFontFamilies {
  const cjk = quoteFontFamily(settings.defaultCJKFont)
  return {
    default: settings.defaultFont,
    serif: uniqueFontStack([
      quoteFontFamily(settings.serifFont),
      cjk,
      '"Noto Serif SC"',
      '"Songti SC"',
      'Georgia',
      '"Times New Roman"',
      'serif',
    ]),
    sansSerif: uniqueFontStack([
      quoteFontFamily(settings.sansSerifFont),
      cjk,
      '"Noto Sans SC"',
      '"PingFang SC"',
      '"Microsoft YaHei"',
      'system-ui',
      'sans-serif',
    ]),
    monospace: uniqueFontStack([
      quoteFontFamily(settings.monospaceFont),
      'ui-monospace',
      'SFMono-Regular',
      'Menlo',
      'Consolas',
      'monospace',
    ]),
  }
}

export async function ensureReaderFontsLoaded(settings: ReaderFontSettings): Promise<void> {
  if (typeof document === 'undefined') return
  const families = Array.from(new Set([
    settings.defaultCJKFont,
    settings.serifFont,
    settings.sansSerifFont,
    settings.monospaceFont,
  ]))
  const googleFamilies = families.map(family => GOOGLE_FONT_QUERIES[family]).filter(Boolean)
  const urls = [
    ...(googleFamilies.length > 0 ? [createGoogleFontsURL(googleFamilies)] : []),
    ...families.map(family => FONT_STYLESHEETS[family]).filter(Boolean),
  ]

  await Promise.all(urls.map(url => loadStylesheet(url).catch(error => {
    console.warn(`Reader font stylesheet failed to load: ${url}`, error)
  })))

  if (!document.fonts?.load) return
  await Promise.all(families.map(family => withTimeout(
    document.fonts.load(`16px ${quoteFontFamily(family)}`, 'Aa中文阅读'),
    3500,
  ).catch(() => undefined)))
}

function createGoogleFontsURL(families: string[]): string {
  const query = families.map(family => `family=${encodeURIComponent(family)}`).join('&')
  return `https://fonts.googleapis.com/css2?${query}&display=swap`
}

function loadStylesheet(url: string): Promise<void> {
  const existing = stylesheetLoads.get(url)
  if (existing) return existing
  const promise = new Promise<void>((resolve, reject) => {
    const mounted = Array.from(document.querySelectorAll<HTMLLinkElement>('link[data-rebook-font-cdn]'))
      .find(link => link.href === url)
    if (mounted) {
      resolve()
      return
    }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    link.crossOrigin = 'anonymous'
    link.dataset.rebookFontCdn = 'true'
    link.onload = () => resolve()
    link.onerror = () => reject(new Error('Stylesheet request failed'))
    document.head.appendChild(link)
  })
  const timed = withTimeout(promise, 5000)
  stylesheetLoads.set(url, timed)
  return timed
}

function withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Font request timed out')), timeout)
    promise.then(
      value => {
        window.clearTimeout(timer)
        resolve(value)
      },
      error => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function quoteFontFamily(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

function uniqueFontStack(families: string[]): string {
  return Array.from(new Set(families)).join(', ')
}
