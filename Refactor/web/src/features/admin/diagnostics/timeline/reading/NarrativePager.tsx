import { Button } from '@/components/ui/button'
import { ChevronLeft, Loader2 } from 'lucide-react'

interface NarrativePagerProps {
  hasEarlier: boolean
  loading: boolean
  onLoadEarlier: () => void
}

export function NarrativePager({ hasEarlier, loading, onLoadEarlier }: NarrativePagerProps) {
  if (!hasEarlier) {
    return (
      <p className="text-center text-[11px] text-muted-foreground/70 py-2">
        Beginning of loaded narrative window
      </p>
    )
  }

  return (
    <div className="flex justify-center py-2">
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={loading} onClick={onLoadEarlier}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        Load earlier
      </Button>
    </div>
  )
}
