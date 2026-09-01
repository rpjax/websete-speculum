import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Download, FileJson, FileSpreadsheet, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ExportButtonProps {
  data: unknown
  filename: string
  className?: string
  formats?: ('json' | 'csv')[]
}

export function ExportButton({ data, filename, className, formats = ['json', 'csv'] }: ExportButtonProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  function exportJson() {
    const json = JSON.stringify(data, null, 2)
    downloadFile(json, `${filename}.json`, 'application/json')
    setOpen(false)
  }

  function exportCsv() {
    const csv = toCsv(data)
    downloadFile(csv, `${filename}.csv`, 'text/csv')
    setOpen(false)
  }

  async function copyJson() {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('h-8 gap-1.5 text-xs', className)}>
          <Download className="h-3 w-3" /> Export
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1.5" align="end">
        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Export as</p>
        {formats.includes('json') && (
          <button onClick={exportJson} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
            <FileJson className="h-3.5 w-3.5 text-muted-foreground" /> JSON
          </button>
        )}
        {formats.includes('csv') && (
          <button onClick={exportCsv} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
            <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" /> CSV
          </button>
        )}
        <button onClick={() => void copyJson()} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
          {copied ? 'Copied!' : 'Copy JSON'}
        </button>
      </PopoverContent>
    </Popover>
  )
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function toCsv(data: unknown): string {
  if (!Array.isArray(data)) return JSON.stringify(data)
  if (data.length === 0) return ''

  const flat = data.map((item) => flattenObject(item as Record<string, unknown>))
  const headers = [...new Set(flat.flatMap(Object.keys))]
  const rows = flat.map((row) => headers.map((h) => escapeCsv(String(row[h] ?? ''))).join(','))
  return [headers.join(','), ...rows].join('\n')
}

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey))
    } else {
      result[fullKey] = String(value ?? '')
    }
  }
  return result
}

function escapeCsv(str: string): string {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}
