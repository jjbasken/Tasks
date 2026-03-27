import { Navigate, Outlet } from 'react-router'
import { session } from '../lib/session.js'

export function ProtectedRoute() {
  return session.getToken() ? <Outlet /> : <Navigate to="/login" replace />
}
