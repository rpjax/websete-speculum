import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { CommandPaletteButton } from './CommandPalette'

type AdminTopBarProps = {
  username: string
  navOpen: boolean
  onNavOpenChange: (open: boolean) => void
  onOpenPalette: () => void
  onSignOut: () => void
  nav: ReactNode
}

function operatorInitials(username: string): string {
  const parts = username.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) {
    const word = parts[0]
    return word.length >= 2 ? word.slice(0, 2).toUpperCase() : word.slice(0, 1).toUpperCase()
  }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

export function AdminTopBar({
  username,
  navOpen,
  onNavOpenChange,
  onOpenPalette,
  onSignOut,
  nav,
}: AdminTopBarProps) {
  const initials = operatorInitials(username)

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="flex h-14 items-center gap-2 px-3 md:gap-3 md:px-4">
        <Sheet open={navOpen} onOpenChange={onNavOpenChange}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 md:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetHeader className="border-b px-4 py-3 text-left">
              <SheetTitle className="text-base">Navigate</SheetTitle>
            </SheetHeader>
            {nav}
          </SheetContent>
        </Sheet>

        <Link
          to="/admin"
          className="flex min-w-0 items-center gap-2.5 rounded-md outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="Speculum Admin home"
        >
          {/* Temporary monogram — replace when brand asset exists */}
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-card text-[0.7rem] font-semibold tracking-[0.04em] text-foreground shadow-sm"
          >
            S
          </span>
          <span className="flex min-w-0 items-baseline gap-1.5 truncate">
            <span className="text-[0.95rem] font-semibold tracking-tight text-foreground">
              Speculum
            </span>
            <span className="hidden text-sm font-medium tracking-wide text-muted-foreground sm:inline">
              Admin
            </span>
          </span>
        </Link>

        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'h-9 max-w-[11rem] gap-2 border-border/80 bg-card/60 px-1.5 pl-1.5 pr-2',
                  'text-foreground hover:bg-muted',
                )}
                aria-label={`Operator menu for ${username}`}
              >
                <span
                  aria-hidden
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted text-[0.65rem] font-semibold tracking-wide text-foreground"
                >
                  {initials}
                </span>
                <span className="hidden min-w-0 truncate text-sm font-medium sm:inline">
                  {username}
                </span>
                <ChevronDown
                  className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:inline"
                  aria-hidden
                />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-1.5">
              <div className="px-2.5 py-2">
                <p className="truncate text-sm font-medium text-foreground">{username}</p>
                <p className="text-xs text-muted-foreground">Operator</p>
              </div>
              <div className="my-1 h-px bg-border" />
              <Link
                className="block rounded-md px-2.5 py-2 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                to="/admin/change-password"
              >
                Change password
              </Link>
              <button
                type="button"
                className="w-full rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                onClick={onSignOut}
              >
                Sign out
              </button>
            </PopoverContent>
          </Popover>
          <CommandPaletteButton onClick={onOpenPalette} />
        </div>
      </div>
    </header>
  )
}
