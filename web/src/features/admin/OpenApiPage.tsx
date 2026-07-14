import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { PageHeader } from '@/components/admin/PageHeader'
import { JsonTechnicalDetails } from '@/components/admin/JsonTechnicalDetails'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { API_URL } from '@/lib/env'

export default function OpenApiPage() {
  const [doc, setDoc] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getOpenApi()
      .then(setDoc)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load OpenAPI'))
  }, [])

  const href = `${API_URL}/openapi/v1.json`

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="OpenAPI"
        description="Machine-readable HTTP surface for automation. Prefer Admin screens for day-to-day operations."
      />
      <Card>
        <CardHeader>
          <CardTitle>Document endpoint</CardTitle>
          <CardDescription>Fetch the raw OpenAPI document from the motor host.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild variant="outline">
            <a href={href} target="_blank" rel="noreferrer">Open /openapi/v1.json</a>
          </Button>
          {error && <p className="text-destructive">{error}</p>}
          {!doc && !error && <Skeleton className="h-24 w-full" />}
          {doc != null && <JsonTechnicalDetails data={doc} title="Technical details (full document)" />}
        </CardContent>
      </Card>
    </div>
  )
}
