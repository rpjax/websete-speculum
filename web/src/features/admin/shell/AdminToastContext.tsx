import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Toast = { id: number; tone: 'success' | 'error' | 'info'; message: string }
type AdminToastApi = { success: (message?: string) => void; error: (message?: string) => void; info: (message: string) => void }
const AdminToastContext = createContext<AdminToastApi | null>(null)
export function AdminToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismiss = useCallback((id: number) => setToasts((items) => items.filter((item) => item.id !== id)), [])
  const push = useCallback((tone: Toast['tone'], message: string) => { const id = Date.now() + Math.random(); setToasts((items) => [...items, { id, tone, message }].slice(-3)); return id }, [])
  const value = useMemo<AdminToastApi>(() => ({ success: (message = 'Saved') => { const id = push('success', message); window.setTimeout(() => dismiss(id), 5000) }, error: (message = 'Something went wrong') => { push('error', message) }, info: (message) => { const id = push('info', message); window.setTimeout(() => dismiss(id), 5000) } }), [dismiss, push])
  return <AdminToastContext.Provider value={value}>{children}<div className="fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">{toasts.map((toast) => <div key={toast.id} role={toast.tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-lg border p-4 shadow-lg ${toast.tone === 'error' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'bg-card'}`}><p className="flex-1 text-sm">{toast.message}</p><Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Dismiss" onClick={() => dismiss(toast.id)}><X className="h-4 w-4" /></Button></div>)}</div></AdminToastContext.Provider>
}
export function useAdminToast() { const value = useContext(AdminToastContext); if (!value) throw new Error('useAdminToast must be used within AdminToastProvider'); return value }

