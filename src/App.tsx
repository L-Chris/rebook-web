import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './features/auth/AuthContext'
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './features/auth/AuthPages'
import { CloudSyncProvider } from './features/cloud-sync/CloudSyncContext'
import { ExtensionStorePage } from './features/extensions/ExtensionStorePage'
import { ExtensionPublisherPage } from './features/extensions/ExtensionPublisherPage'
import { LanguageProvider, useI18n } from './features/i18n/LanguageContext'
import ReaderWorkspace from './features/reader/ReaderWorkspace'
import { ShelfPage } from './features/shelf/ShelfPage'
import { ThemeProvider } from './features/theme/ThemeContext'
import { PreferencesSyncProvider } from './features/preferences/PreferencesSyncContext'

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <PreferencesSyncProvider>
            <CloudSyncProvider>
              <Routes>
                <Route path="/" element={<ShelfPage />} />
                <Route path="/extensions" element={<ExtensionStorePage />} />
                <Route path="/extensions/publish" element={<ProtectedRoute><ExtensionPublisherPage /></ProtectedRoute>} />
                <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
                <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/reader" element={<Navigate to="/" replace />} />
                <Route path="/reader/:bookId" element={<ShelfReaderPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </CloudSyncProvider>
          </PreferencesSyncProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullPageLoading />
  return user ? <Navigate to="/" replace /> : children
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageLoading />
  if (user) return children
  return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
}

function ShelfReaderPage() {
  const { bookId = '' } = useParams()
  const navigate = useNavigate()
  const auth = useAuth()
  return (
    <ReaderWorkspace
      libraryBookId={bookId}
      authenticated={Boolean(auth.user)}
      accountLabel={auth.user?.displayName || auth.user?.email || ''}
      onExit={() => navigate('/')}
      onLogin={() => navigate('/login', { state: { from: `/reader/${bookId}` } })}
      onLogout={() => void auth.logout().then(() => navigate('/'))}
    />
  )
}

function FullPageLoading() {
  const { t } = useI18n()
  return (
    <div className="grid h-full place-items-center bg-bg text-ui-md text-muted">
      {t('common.loading')}
    </div>
  )
}
