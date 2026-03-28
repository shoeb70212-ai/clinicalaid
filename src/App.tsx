import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { AuthProvider } from './hooks/useAuth'
import { ProtectedRoute } from './components/shared/ProtectedRoute'
import { LoadingSpinner } from './components/shared/LoadingSpinner'
import { ToastProvider } from './components/shared/Toast'

// Lazy-load portals to keep initial bundle small
const SetupPortal      = lazy(() => import('./portals/setup/SetupPortal'))
const ReceptionPortal  = lazy(() => import('./portals/reception/ReceptionPortal'))
const DoctorPortal     = lazy(() => import('./portals/doctor/DoctorPortal'))
const DisplayPortal    = lazy(() => import('./portals/display/DisplayPortal').then(m => ({ default: m.DisplayPortal })))
const LoginPage        = lazy(() => import('./components/shared/LoginPage'))
const NotFound         = lazy(() => import('./components/shared/NotFound'))
const ComingSoon        = lazy(() => import('./components/shared/ComingSoon'))
const VerifyMFA        = lazy(() => import('./components/shared/VerifyMFA').then(m => ({ default: m.VerifyMFA })))
const Unauthorized     = lazy(() => import('./components/shared/Unauthorized').then(m => ({ default: m.Unauthorized })))
const AuthCallback     = lazy(() => import('./components/shared/AuthCallback'))

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <Suspense fallback={<LoadingSpinner fullScreen />}>
          <Routes>
            {/* Public routes */}
            <Route path="/setup"   element={<SetupPortal />} />
            <Route path="/login"   element={<LoginPage />} />
            <Route path="/invite"  element={<LoginPage mode="invite" />} />

            {/* Protected portals */}
            <Route
              path="/reception/*"
              element={
                <ProtectedRoute allowedRoles={['receptionist', 'admin']}>
                  <ReceptionPortal />
                </ProtectedRoute>
              }
            />
            <Route
              path="/doctor/*"
              element={
                <ProtectedRoute allowedRoles={['doctor', 'admin']} requireMFA>
                  <DoctorPortal />
                </ProtectedRoute>
              }
            />

            {/* Display portal — handled by DisplayPortal itself (scoped JWT) */}
            <Route path="/display" element={<DisplayPortal />} />

            {/* Auth utility pages */}
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/verify-mfa"    element={<VerifyMFA />} />
            <Route path="/unauthorized"  element={<Unauthorized />} />

            {/* V2 reserved routes */}
            <Route path="/kiosk"   element={<ComingSoon feature="Patient Kiosk" />} />
            <Route path="/patient" element={<ComingSoon feature="Patient Portal" />} />

            {/* Default redirect */}
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
