import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './features/auth/AuthContext'
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './features/auth/AuthPages'
import { CloudDrivePage } from './features/cloud-drive/CloudDrivePage'
import { ExtensionStorePage } from './features/extensions/ExtensionStorePage'
import ReaderWorkspace from './features/reader/ReaderWorkspace'
import { SettingsPage } from './features/settings/SettingsPage'
import { ShelfPage } from './features/shelf/ShelfPage'
import { ThemeProvider } from './features/theme/ThemeContext'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<ShelfPage />} />
          <Route path="/extensions" element={<ExtensionStorePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/reader" element={<Navigate to="/" replace />} />
          <Route path="/reader/:bookId" element={<ShelfReaderPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<LibraryLayout />}>
              <Route path="/settings/cloud-drives" element={<CloudDrivePage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  )
}

function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageLoading />
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullPageLoading />
  return user ? <Navigate to="/" replace /> : children
}

function LibraryLayout() {
  return (
    <div className="h-full overflow-y-auto bg-bg">
      <Outlet />
    </div>
  )
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
  return (
    <div className="grid h-full place-items-center bg-bg text-ui-md text-muted">
      加载中…
    </div>
  )
}
