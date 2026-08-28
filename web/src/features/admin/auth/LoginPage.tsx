import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminLogin, AdminApiError } from '@/lib/adminFetch'
import { isAdminAuthenticated, safeReturnUrl } from '@/lib/adminAuth'
import { HelperCallout, InlineValidation, SaveFeedback } from '@/features/admin/components'

export function LoginPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const returnUrl = safeReturnUrl(params.get('returnUrl'))

  if (isAdminAuthenticated()) {
    return <Navigate to={returnUrl} replace />
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      setError('Enter your username and password.')
      return
    }
    setPending(true)
    try {
      await adminLogin(username.trim(), password)
      navigate(returnUrl, { replace: true })
    } catch (cause) {
      setError(
        cause instanceof AdminApiError && cause.message === 'invalid_credentials'
          ? 'Incorrect username or password.'
          : 'Sign-in failed. Try again.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Speculum</CardTitle>
          <CardDescription>Admin sign-in</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div>
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                disabled={pending}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <InlineValidation message={!username && error ? 'Username is required.' : undefined} />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                disabled={pending}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error ? <SaveFeedback mode="inline-error" message={error} /> : null}
            <Button className="w-full" type="submit" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <HelperCallout tone="info" title="Operator account">
            Use your operator account. Default install uses admin until you change the password.
          </HelperCallout>
        </CardContent>
      </Card>
    </main>
  )
}
