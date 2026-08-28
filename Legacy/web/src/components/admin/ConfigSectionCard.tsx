import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SaveFeedbackStrip } from '@/components/admin/SaveFeedbackStrip'

interface ConfigSectionCardProps {
  title: string
  description?: string
  loading?: boolean
  pending?: boolean
  message?: string | null
  error?: string | null
  onSave: () => void
  secondary?: ReactNode
  children: ReactNode
}

export function ConfigSectionCard({
  title,
  description,
  loading,
  pending,
  message,
  error,
  onSave,
  secondary,
  children,
}: ConfigSectionCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? <Skeleton className="h-24 w-full" /> : children}
        {!loading && (
          <SaveFeedbackStrip
            pending={pending}
            message={message}
            error={error}
            onSave={onSave}
            secondary={secondary}
          />
        )}
      </CardContent>
    </Card>
  )
}
