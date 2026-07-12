import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function SetupPage() {
  const [missing, setMissing] = useState<string[]>([])
  const [operational, setOperational] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getStatus()
      .then((s) => {
        setMissing(s.missing)
        setOperational(s.operational)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load status'))
  }, [])

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-2 text-2xl font-semibold tracking-wide">Speculum — Setup</h1>
      <p className="mb-8 text-muted-foreground">Motor bootstrap wizard (W7S)</p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>Runtime configuration state</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <p className="text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            <span>Operational:</span>
            <Badge className={operational ? 'border-green-700 text-green-400' : 'border-amber-700 text-amber-400'}>
              {operational ? 'yes' : 'no'}
            </Badge>
          </div>
          {!operational && missing.length > 0 && (
            <ul className="list-disc pl-5 text-amber-400">
              {missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Next steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Configure required sections via the admin panel after logging in with your API key.</p>
          <Button asChild>
            <Link to="/admin/login">Open admin</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
