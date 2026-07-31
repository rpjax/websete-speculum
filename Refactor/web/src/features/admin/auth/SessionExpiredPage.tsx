import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { safeReturnUrl } from '@/lib/adminAuth'
export function SessionExpiredPage() { const [params] = useSearchParams(); const ref = useRef<HTMLAnchorElement>(null); const returnUrl = safeReturnUrl(params.get('returnUrl')); useEffect(() => ref.current?.focus(), []); return <main className="grid min-h-screen place-items-center p-4"><Card className="w-full max-w-md"><CardHeader><CardTitle>Speculum Admin</CardTitle><CardDescription>Session expired</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">Your sign-in is no longer valid. Sign in again to continue.</p><Button asChild className="mt-6"><Link ref={ref} to={`/admin/login?returnUrl=${encodeURIComponent(returnUrl)}`}>Sign in</Link></Button></CardContent></Card></main> }
