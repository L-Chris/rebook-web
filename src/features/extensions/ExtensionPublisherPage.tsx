import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock3,
  Download,
  ExternalLink,
  FileArchive,
  Loader2,
  PackageCheck,
  RefreshCw,
  Send,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react'
import type { RebookExtensionManifest } from 'rebook'
import { apiRequest, apiUrl } from '../../lib/api'
import { iconButtonClass, primaryButtonClass, toolbarButtonClass } from '../../lib/ui-classes'
import { useAuth } from '../auth/AuthContext'
import { useI18n, type MessageKey, type Translate } from '../i18n/LanguageContext'

const MAX_PACKAGE_SIZE = 25 * 1024 * 1024

type ExtensionVersionState = 'draft' | 'submitted' | 'scanning' | 'approved' | 'rejected' | 'revoked'

type ExtensionVersionSummary = {
  id: string
  extensionId: string
  version: string
  manifest: RebookExtensionManifest
  state: ExtensionVersionState
  listed: boolean
  entry: { integrity: string; size: number; contentType: string }
  package: { integrity: string; size: number }
  scan: { fileCount: number; uncompressedSize: number; warnings: string[] }
  submittedAt?: string
  publishedAt?: string
  rejectedAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
}

const stateMetadata: Record<ExtensionVersionState, {
  label: MessageKey
  className: string
}> = {
  draft: { label: 'publisher.stateDraft', className: 'bg-surface-muted text-ink-soft' },
  submitted: { label: 'publisher.stateSubmitted', className: 'bg-accent-soft text-accent-text' },
  scanning: { label: 'publisher.stateScanning', className: 'bg-accent-soft text-accent-text' },
  approved: { label: 'publisher.stateApproved', className: 'bg-success-soft text-success' },
  rejected: { label: 'publisher.stateRejected', className: 'bg-danger-soft text-danger' },
  revoked: { label: 'publisher.stateRevoked', className: 'bg-danger-soft text-danger' },
}

export function ExtensionPublisherPage() {
  const navigate = useNavigate()
  const auth = useAuth()
  const { user } = auth
  const { language, t } = useI18n()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [versions, setVersions] = useState<ExtensionVersionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [sendingVerification, setSendingVerification] = useState(false)
  const [submittingId, setSubmittingId] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const verified = Boolean(user?.emailVerifiedAt)

  const loadVersions = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setVersions(await apiRequest<ExtensionVersionSummary[]>('/extensions/submissions/mine'))
    } catch (reason) {
      setError(humanizeError(reason, t, 'publisher.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadVersions()
  }, [loadVersions])

  const groupedVersions = useMemo(() => {
    const groups = new Map<string, ExtensionVersionSummary[]>()
    for (const version of versions) {
      const group = groups.get(version.extensionId) ?? []
      group.push(version)
      groups.set(version.extensionId, group)
    }
    return [...groups.entries()]
  }, [versions])

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null
    setNotice('')
    setError('')
    if (!next) {
      setFile(null)
      return
    }
    if (!next.name.toLocaleLowerCase().endsWith('.zip')) {
      setFile(null)
      setError(t('publisher.zipOnly'))
      event.target.value = ''
      return
    }
    if (next.size > MAX_PACKAGE_SIZE) {
      setFile(null)
      setError(t('publisher.packageTooLarge'))
      event.target.value = ''
      return
    }
    setFile(next)
  }

  const upload = async (event: FormEvent) => {
    event.preventDefault()
    if (!file || !verified || uploading) return
    setUploading(true)
    setError('')
    setNotice('')
    try {
      const body = new FormData()
      body.append('package', file, file.name)
      const version = await apiRequest<ExtensionVersionSummary>('/extensions/submissions', {
        method: 'POST',
        body,
      })
      setVersions(current => [version, ...current.filter(item => item.id !== version.id)])
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setNotice(t('publisher.uploadedNotice', {
        name: version.manifest.displayName || version.manifest.name,
        version: version.version,
      }))
    } catch (reason) {
      setError(humanizeError(reason, t, 'publisher.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const submitForReview = async (version: ExtensionVersionSummary) => {
    if (submittingId) return
    setSubmittingId(version.id)
    setError('')
    setNotice('')
    try {
      const submitted = await apiRequest<ExtensionVersionSummary>(
        `/extensions/versions/${encodeURIComponent(version.id)}/submit`,
        { method: 'POST', json: {} },
      )
      setVersions(current => current.map(item => item.id === submitted.id ? submitted : item))
      setNotice(t('publisher.submittedNotice', {
        name: submitted.manifest.displayName || submitted.manifest.name,
        version: submitted.version,
      }))
    } catch (reason) {
      setError(humanizeError(reason, t, 'publisher.submitFailed'))
    } finally {
      setSubmittingId('')
    }
  }

  const resendVerification = async () => {
    if (!user?.email || sendingVerification) return
    setSendingVerification(true)
    setError('')
    setNotice('')
    try {
      await auth.resendVerification(user.email)
      setNotice(t('publisher.verificationSent'))
    } catch (reason) {
      setError(humanizeError(reason, t, 'publisher.verificationFailed'))
    } finally {
      setSendingVerification(false)
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-bg text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/92 px-4 backdrop-blur-xl md:px-7">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3">
          <button className={iconButtonClass} type="button" aria-label={t('publisher.backToStore')} onClick={() => navigate('/extensions')}>
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <UploadCloud className="h-4 w-4 text-accent-text" />
            <h1 className="truncate text-ui-lg font-semibold">{t('publisher.title')}</h1>
          </div>
          <a
            className={`${toolbarButtonClass} ml-auto`}
            href="https://github.com/L-Chris/rebook/tree/main/docs/extensions"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden sm:inline">{t('publisher.developerDocs')}</span>
          </a>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-7 md:px-7 md:py-10">
        {notice ? (
          <div className="mb-5 flex items-center gap-2 rounded-xl border border-success-line bg-success-soft px-4 py-3 text-ui-md text-success">
            <Check className="h-4 w-4 shrink-0" />
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="mb-5 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-ui-md text-danger">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
          <div className="space-y-5">
          <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-menu">
            <div className="border-b border-line px-5 py-5 sm:px-6">
              <p className="text-ui-sm font-semibold uppercase tracking-[0.12em] text-accent-text">Rebook Extensions</p>
              <h2 className="mt-2 text-xl font-semibold">{t('publisher.uploadTitle')}</h2>
              <p className="mt-2 text-ui-md leading-6 text-muted">{t('publisher.uploadDescription')}</p>
            </div>

            <form className="p-5 sm:p-6" onSubmit={upload}>
              {!verified ? (
                <div className="mb-4 flex gap-3 rounded-xl border border-warning-line bg-warning-soft px-4 py-3 text-ui-md text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">{t('publisher.verifyTitle')}</p>
                    <p className="mt-1 text-ui-sm opacity-90">{t('publisher.verifyDescription')}</p>
                    <button
                      className="mt-2 font-medium underline underline-offset-2 disabled:opacity-50"
                      type="button"
                      disabled={sendingVerification}
                      onClick={() => void resendVerification()}
                    >
                      {sendingVerification ? t('publisher.sendingVerification') : t('publisher.resendVerification')}
                    </button>
                  </div>
                </div>
              ) : null}

              <label className={`group flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-5 py-8 text-center transition ${
                file ? 'border-accent bg-accent-soft' : 'border-line-strong bg-bg hover:border-accent hover:bg-accent-soft/50'
              } ${!verified || uploading ? 'pointer-events-none opacity-60' : ''}`}>
                <input
                  ref={fileInputRef}
                  className="sr-only"
                  type="file"
                  accept=".zip,application/zip"
                  disabled={!verified || uploading}
                  onChange={chooseFile}
                />
                {file ? <FileArchive className="h-9 w-9 text-accent-text" /> : <UploadCloud className="h-9 w-9 text-muted transition group-hover:text-accent-text" />}
                <span className="mt-3 max-w-full truncate text-ui-md font-semibold">
                  {file?.name || t('publisher.choosePackage')}
                </span>
                <span className="mt-1 text-ui-sm text-muted">
                  {file ? formatBytes(file.size, language) : t('publisher.packageHint')}
                </span>
              </label>

              <button className={`${primaryButtonClass} mt-4 w-full`} type="submit" disabled={!file || !verified || uploading}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {uploading ? t('publisher.uploading') : t('publisher.uploadDraft')}
              </button>
              <p className="mt-3 text-ui-sm leading-5 text-muted">{t('publisher.immutableHint')}</p>
            </form>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent-text" />
              <div>
                <h2 className="text-ui-lg font-semibold">{t('publisher.reviewTitle')}</h2>
                <p className="mt-1 text-ui-sm leading-5 text-muted">{t('publisher.reviewDescription')}</p>
              </div>
            </div>
          </section>
        </div>

        <section className="min-w-0 rounded-2xl border border-line bg-surface shadow-menu">
          <div className="flex items-center gap-3 border-b border-line px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 className="text-ui-lg font-semibold">{t('publisher.mySubmissions')}</h2>
              <p className="mt-0.5 text-ui-sm text-muted">{t('publisher.submissionCount', { count: versions.length })}</p>
            </div>
            <button className={`${iconButtonClass} ml-auto`} type="button" aria-label={t('publisher.refresh')} disabled={loading} onClick={() => void loadVersions()}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="p-5 sm:p-6">
            {loading ? (
              <div className="grid min-h-44 place-items-center text-muted">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : groupedVersions.length ? (
              <div className="space-y-5">
                {groupedVersions.map(([extensionId, entries]) => (
                  <div key={extensionId} className="overflow-hidden rounded-xl border border-line">
                    <div className="bg-surface-muted px-4 py-3">
                      <h3 className="truncate text-ui-md font-semibold">{entries[0]?.manifest.displayName || entries[0]?.manifest.name}</h3>
                      <p className="mt-0.5 truncate font-mono text-xs text-muted">{extensionId}</p>
                    </div>
                    <div className="divide-y divide-line">
                      {entries.map(version => (
                        <VersionRow
                          key={version.id}
                          version={version}
                          submitting={submittingId === version.id}
                          locale={language}
                          t={t}
                          onSubmit={() => void submitForReview(version)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid min-h-52 place-items-center rounded-xl border border-dashed border-line-strong bg-bg text-center">
                <div className="px-6">
                  <PackageCheck className="mx-auto h-9 w-9 text-muted" />
                  <h3 className="mt-3 text-ui-lg font-semibold">{t('publisher.emptyTitle')}</h3>
                  <p className="mt-1 text-ui-md text-muted">{t('publisher.emptyDescription')}</p>
                </div>
              </div>
            )}
          </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function VersionRow({
  version,
  submitting,
  locale,
  t,
  onSubmit,
}: {
  version: ExtensionVersionSummary
  submitting: boolean
  locale: string
  t: Translate
  onSubmit(): void
}) {
  const state = stateMetadata[version.state]
  return (
    <article className="px-4 py-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-ui-md font-semibold">v{version.version}</span>
            <span className={`rounded-full px-2 py-1 text-xs font-medium ${state.className}`}>{t(state.label)}</span>
            <span className="rounded-full bg-surface-muted px-2 py-1 text-xs text-muted">{version.manifest.runtime?.kind || 'trusted'}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>{t('publisher.packageSize', { size: formatBytes(version.package.size, locale) })}</span>
            <span>{t('publisher.fileCount', { count: version.scan.fileCount })}</span>
            <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{formatDate(version.createdAt, locale)}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <a
            className={iconButtonClass}
            href={apiUrl(`/extensions/versions/${encodeURIComponent(version.id)}/package`)}
            aria-label={t('publisher.downloadPackage')}
            title={t('publisher.downloadPackage')}
          >
            <Download className="h-4 w-4" />
          </a>
          {version.state === 'draft' ? (
            <button className={primaryButtonClass} type="button" disabled={submitting} onClick={onSubmit}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? t('publisher.submitting') : t('publisher.submitReview')}
            </button>
          ) : null}
        </div>
      </div>
      {version.scan.warnings.length ? (
        <div className="mt-3 rounded-lg border border-warning-line bg-warning-soft px-3 py-2 text-ui-sm text-warning">
          <p className="font-medium">{t('publisher.scanWarnings', { count: version.scan.warnings.length })}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {version.scan.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
          </ul>
        </div>
      ) : null}
    </article>
  )
}

function formatBytes(value: number, locale: string): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const amount = value / 1024 ** exponent
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: exponent ? 1 : 0 }).format(amount)} ${units[exponent]}`
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function humanizeError(reason: unknown, t: Translate, fallback: MessageKey): string {
  const message = reason instanceof Error ? reason.message : ''
  if (/verified publisher email/i.test(message)) return t('publisher.verifyRequired')
  if (/upload limit/i.test(message)) return t('publisher.uploadLimit')
  if (/already exists|immutable/i.test(message)) return t('publisher.versionExists')
  if (/ZIP package|invalid zip|not a zip/i.test(message)) return t('publisher.invalidPackage')
  return message || t(fallback)
}
