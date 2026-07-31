import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { isAdminAuthenticated, safeReturnUrl } from '@/lib/adminAuth'
export function RequireAuth() { const location = useLocation(); if (isAdminAuthenticated()) return <Outlet />; const returnUrl = safeReturnUrl(`${location.pathname}${location.search}`); return <Navigate to={`/admin/login?returnUrl=${encodeURIComponent(returnUrl)}`} replace /> }
