import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { trpc, createTrpcClient } from './lib/trpc.js'
import { queryClient } from './lib/queryClient.js'
import { session } from './lib/session.js'
import { AuthProvider, useAuth } from './hooks/useAuth.js'
import { ProtectedRoute } from './components/ProtectedRoute.js'
import { LoginPage } from './routes/LoginPage.js'
import { RegisterPage } from './routes/RegisterPage.js'
import { TasksPage } from './routes/TasksPage.js'
import { ListsPage } from './routes/ListsPage.js'
import { DevicesPage } from './routes/DevicesPage.js'
import { SettingsPage } from './routes/SettingsPage.js'
import { RequestDevicePage } from './routes/RequestDevicePage.js'

function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()
  return isAdmin ? <>{children}</> : <Navigate to="/tasks" replace />
}

export function App() {
  const [trpcClient] = useState(() => createTrpcClient(() => session.getToken()))
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/device-request" element={<RequestDevicePage />} />
              <Route element={<ProtectedRoute />}>
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/lists" element={<ListsPage />} />
                <Route path="/devices" element={<DevicesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/register" element={<AdminRoute><RegisterPage /></AdminRoute>} />
              </Route>
              <Route path="*" element={<Navigate to="/tasks" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </trpc.Provider>
  )
}
