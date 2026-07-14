import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type SessionDetail } from '@/lib/api'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/admin/PageHeader'
import { EmptyState } from '@/components/admin/EmptyState'
import { JsonTechnicalDetails } from '@/components/admin/JsonTechnicalDetails'

export default function SessionDetailPage() {
  const { sessionId } = useParams()
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [peek, setPeek] = useState<{ title: string; body: string } | null>(null)

  useEffect(() => {
    if (!sessionId) return
    api.getSession(sessionId)
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [sessionId])

  if (error) return <p className="text-destructive">{error}</p>
  if (!detail) return <Skeleton className="h-40 w-full" />

  return (
    <div className="space-y-4">
      <Link to="/admin/sessions" className="text-sm text-primary hover:underline">← Sessions</Link>
      <PageHeader
        title="Session detail"
        description={`Client token ${detail.clientToken}`}
      />
      <p className="font-mono text-xs text-muted-foreground">{detail.sessionId}</p>

      <Tabs defaultValue="cookies">
        <TabsList>
          <TabsTrigger value="cookies">Cookies ({detail.cookies.length})</TabsTrigger>
          <TabsTrigger value="ls">Local storage ({detail.localStorage.length})</TabsTrigger>
          <TabsTrigger value="idb">IndexedDB ({detail.idbRecords.length})</TabsTrigger>
          <TabsTrigger value="history">History ({detail.history.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="cookies">
          {detail.cookies.length === 0 ? (
            <EmptyState title="No cookies" description="This session has no stored cookies." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Path</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.cookies.map((c, i) => (
                  <TableRow
                    key={i}
                    className="cursor-pointer"
                    onClick={() => setPeek({ title: c.name, body: c.value })}
                  >
                    <TableCell>{c.name}</TableCell>
                    <TableCell className="text-xs">{c.domain}</TableCell>
                    <TableCell className="text-xs">{c.path}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="ls">
          {detail.localStorage.length === 0 ? (
            <EmptyState title="No local storage" description="No origin keys persisted." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Origin</TableHead>
                  <TableHead>Key</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.localStorage.map((l, i) => (
                  <TableRow
                    key={i}
                    className="cursor-pointer"
                    onClick={() => setPeek({ title: l.key, body: l.value })}
                  >
                    <TableCell className="max-w-[12rem] truncate text-xs">{l.origin}</TableCell>
                    <TableCell>{l.key}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="idb">
          {detail.idbRecords.length === 0 ? (
            <EmptyState title="No IndexedDB rows" description="No IDB records for this session." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Origin</TableHead>
                  <TableHead>Database</TableHead>
                  <TableHead>Store</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.idbRecords.map((r, i) => (
                  <TableRow
                    key={i}
                    className="cursor-pointer"
                    onClick={() => setPeek({ title: `${r.databaseName}/${r.storeName}`, body: r.keyJson })}
                  >
                    <TableCell className="max-w-[10rem] truncate text-xs">{r.origin}</TableCell>
                    <TableCell className="text-xs">{r.databaseName}</TableCell>
                    <TableCell className="text-xs">{r.storeName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="history">
          {detail.history.length === 0 ? (
            <EmptyState title="No history" description="Navigation history is empty." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Title</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.history.map((h, i) => (
                  <TableRow key={i}>
                    <TableCell>{h.indexOrder}</TableCell>
                    <TableCell className="max-w-md truncate text-xs">{h.url}</TableCell>
                    <TableCell className="text-xs">{h.title}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>

      <JsonTechnicalDetails data={detail} title="Full session payload" />

      <Sheet open={!!peek} onOpenChange={(open) => !open && setPeek(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{peek?.title}</SheetTitle>
          </SheetHeader>
          <pre className="mt-4 max-h-[70vh] overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-background p-3 text-xs">
            {peek?.body}
          </pre>
        </SheetContent>
      </Sheet>
    </div>
  )
}
