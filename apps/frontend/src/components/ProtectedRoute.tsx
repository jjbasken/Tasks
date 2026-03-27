import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../hooks/useAuth.js'

export function ProtectedRoute() {
  const { isLoggedIn } = useAuth()
  return isLoggedIn ? <Outlet /> : <Navigate to="/login" replace />
}
