import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function OpenApiPage() {
  const [doc, setDoc] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getOpenApi()
      .then((v) => setDoc(JSON.stringify(v, null, 2)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load OpenAPI'))
  }, [])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">OpenAPI</h1>
      <Card>
        <CardHeader><CardTitle>/openapi/v1.json</CardTitle></CardHeader>
        <CardContent>
          {error && <p className="text-destructive">{error}</p>}
          <Textarea className="min-h-[60vh] font-mono text-xs" readOnly value={doc} />
        </CardContent>
      </Card>
    </div>
  )
}
