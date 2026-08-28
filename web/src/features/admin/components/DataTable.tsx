import {
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { EmptyState } from './EmptyState'

export const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100]

/**
 * Operator-grade data table: server-driven sorting + pagination over shadcn's Table
 * primitives via TanStack Table (headless). Sessions and Profiles listings share this
 * so filter/sort/paginate behavior stays identical across both.
 */
export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  /** Total row count across all pages (server total, not `data.length`). */
  totalCount: number
  pagination: PaginationState
  onPaginationChange: OnChangeFn<PaginationState>
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  pageSizeOptions?: number[]
  isLoading?: boolean
  emptyTitle?: string
  emptyBody?: string
  onRowClick?: (row: TData) => void
  getRowId?: (row: TData, index: number) => string
  className?: string
}

export function DataTable<TData>({
  columns,
  data,
  totalCount,
  pagination,
  onPaginationChange,
  sorting,
  onSortingChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  isLoading = false,
  emptyTitle = 'Nothing here yet',
  emptyBody = 'No rows match the current filters.',
  onRowClick,
  getRowId,
  className,
}: DataTableProps<TData>) {
  const pageCount = Math.max(1, Math.ceil(totalCount / pagination.pageSize))

  const table = useReactTable({
    data,
    columns,
    state: { pagination, sorting },
    manualPagination: true,
    manualSorting: true,
    pageCount,
    onPaginationChange,
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
  })

  const rows = table.getRowModel().rows
  const from = totalCount === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1
  const to = Math.min(totalCount, (pagination.pageIndex + 1) * pagination.pageSize)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="flex items-center gap-1 text-left font-medium text-muted-foreground hover:text-foreground"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="p-0">
                  <EmptyState
                    title={isLoading ? 'Loading…' : emptyTitle}
                    body={isLoading ? 'Fetching rows…' : emptyBody}
                  />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(onRowClick && 'cursor-pointer')}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <Select
            value={String(pagination.pageSize)}
            onValueChange={(value) =>
              onPaginationChange((prev) => ({ pageIndex: 0, pageSize: Number(value) || prev.pageSize }))
            }
          >
            <SelectTrigger className="h-7 w-[72px] text-xs" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3">
          <span>
            {totalCount === 0 ? 'No rows' : `Showing ${from}–${to} of ${totalCount}`}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label="Previous page"
              disabled={pagination.pageIndex === 0}
              onClick={() =>
                onPaginationChange((prev) => ({ ...prev, pageIndex: Math.max(0, prev.pageIndex - 1) }))
              }
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="tabular-nums">
              Page {pagination.pageIndex + 1} of {pageCount}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label="Next page"
              disabled={pagination.pageIndex + 1 >= pageCount}
              onClick={() =>
                onPaginationChange((prev) => ({
                  ...prev,
                  pageIndex: Math.min(pageCount - 1, prev.pageIndex + 1),
                }))
              }
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
