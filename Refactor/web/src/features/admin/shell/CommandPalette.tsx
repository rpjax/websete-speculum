import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, KeyRound, LogOut, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type CommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSignOut: () => void
}

const goTo = [
  { label: 'Home', href: '/w7s/admin' },
  { label: 'Sessions', href: '/w7s/admin/sessions' },
  { label: 'Profiles', href: '/w7s/admin/profiles' },
  { label: 'Scripts', href: '/w7s/admin/scripts' },
  { label: 'Configurations', href: '/w7s/admin/configurations' },
  { label: 'Host resources', href: '/w7s/admin/host-resources' },
  { label: 'Health', href: '/w7s/admin/diagnostics/health' },
  { label: 'Resources', href: '/w7s/admin/diagnostics/resources' },
  { label: 'Signals', href: '/w7s/admin/diagnostics/signals' },
  { label: 'Journal', href: '/w7s/admin/diagnostics/timeline' },
  { label: 'Investigate', href: '/w7s/admin/diagnostics/investigate' },
  { label: 'Reports', href: '/w7s/admin/diagnostics/reports' },
  { label: 'Governance', href: '/w7s/admin/diagnostics/governance' },
]

function shortcutLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl+K'
  const platform = navigator.platform || ''
  const ua = navigator.userAgent || ''
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS/i.test(ua) ? '⌘K' : 'Ctrl+K'
}

export function CommandPalette({ open, onOpenChange, onSignOut }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const matches = useMemo(() => {
    const text = query.trim().toLowerCase()
    return {
      pages: goTo.filter((item) => item.label.toLowerCase().includes(text)),
      actions: [
        {
          label: 'Change password',
          action: () => navigate('/w7s/admin/change-password'),
          icon: KeyRound,
        },
        { label: 'Sign out', action: onSignOut, icon: LogOut },
      ].filter((item) => item.label.toLowerCase().includes(text)),
    }
  }, [navigate, onSignOut, query])

  const visit = (href: string) => {
    navigate(href)
    onOpenChange(false)
  }

  const run = (action: () => void) => {
    action()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 sm:max-w-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>Search pages and actions.</DialogDescription>
        </DialogHeader>
        <div className="border-b p-4">
          <Input
            autoFocus
            placeholder="Filter commands…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {matches.pages.length || matches.actions.length ? (
            <>
              {matches.pages.length ? (
                <CommandGroup label="Go to">
                  {matches.pages.map((item) => (
                    <button
                      key={item.href}
                      type="button"
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => visit(item.href)}
                    >
                      {item.label}
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                </CommandGroup>
              ) : null}
              {matches.actions.length ? (
                <CommandGroup label="Actions">
                  {matches.actions.map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.label}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => run(item.action)}
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        {item.label}
                      </button>
                    )
                  })}
                </CommandGroup>
              ) : null}
            </>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">No matching commands</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CommandGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="p-2">
      <h2 className="px-3 pb-1 text-xs font-medium text-muted-foreground">{label}</h2>
      {children}
    </section>
  )
}

export function CommandPaletteButton({ onClick }: { onClick: () => void }) {
  const shortcut = shortcutLabel()

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        'h-9 gap-2 border-border/80 bg-card/60 px-2 text-muted-foreground hover:bg-muted hover:text-foreground',
        'sm:min-w-[11.5rem] sm:justify-start sm:px-3',
      )}
      onClick={onClick}
      aria-label={`Search / actions (${shortcut})`}
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <span className="hidden flex-1 text-left text-sm font-normal sm:inline">Search</span>
      <kbd
        className={cn(
          'pointer-events-none hidden h-5 items-center rounded border border-border',
          'bg-muted/50 px-1.5 font-mono text-[10px] leading-none text-muted-foreground sm:inline-flex',
        )}
      >
        {shortcut}
      </kbd>
    </Button>
  )
}

export { goTo as adminCommandDestinations }
