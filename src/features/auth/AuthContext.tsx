import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  apiRequest,
  setCsrfToken,
  type AuthUser,
} from '../../lib/api'

type AuthResult = {
  user: AuthUser
  csrfToken: string
}

type AuthContextValue = {
  user: AuthUser | null
  loading: boolean
  refresh: () => Promise<void>
  register: (input: {
    email: string
    password: string
    displayName?: string
  }) => Promise<{ ok: boolean; message: string }>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  verifyEmail: (token: string) => Promise<void>
  resendVerification: (email: string) => Promise<{ ok: boolean; message: string }>
  requestPasswordReset: (email: string) => Promise<{ ok: boolean; message: string }>
  resetPassword: (token: string, password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const applyAuth = useCallback((result: AuthResult | null) => {
    setUser(result?.user || null)
    setCsrfToken(result?.csrfToken)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const result = await apiRequest<{
        user: AuthUser | null
        csrfToken: string | null
      }>('/auth/me')
      setUser(result.user)
      setCsrfToken(result.csrfToken)
    } catch {
      setUser(null)
      setCsrfToken(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const unauthorized = () => {
      setUser(null)
      setCsrfToken(null)
    }
    window.addEventListener('rebook:unauthorized', unauthorized)
    return () => window.removeEventListener('rebook:unauthorized', unauthorized)
  }, [refresh])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    refresh,
    register: input =>
      apiRequest('/auth/register', {
        method: 'POST',
        json: input,
      }),
    login: async (email, password) => {
      applyAuth(await apiRequest<AuthResult>('/auth/login', {
        method: 'POST',
        json: { email, password },
      }))
    },
    logout: async () => {
      await apiRequest('/auth/logout', { method: 'POST', json: {} })
      applyAuth(null)
    },
    verifyEmail: async token => {
      applyAuth(await apiRequest<AuthResult>('/auth/email/verify', {
        method: 'POST',
        json: { token },
      }))
    },
    resendVerification: email =>
      apiRequest('/auth/email/resend', {
        method: 'POST',
        json: { email },
      }),
    requestPasswordReset: email =>
      apiRequest('/auth/password/forgot', {
        method: 'POST',
        json: { email },
      }),
    resetPassword: async (token, password) => {
      applyAuth(await apiRequest<AuthResult>('/auth/password/reset', {
        method: 'POST',
        json: { token, password },
      }))
    },
  }), [applyAuth, loading, refresh, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
