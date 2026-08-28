import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table'
import { DataTable } from './DataTable'

interface Row {
  id: string
  name: string
}

const columns: ColumnDef<Row, unknown>[] = [
  { id: 'id', accessorKey: 'id', header: 'Id', enableSorting: false },
  { id: 'name', accessorKey: 'name', header: 'Name' },
]

afterEach(() => cleanup())

function renderTable(overrides: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  const onPaginationChange = vi.fn()
  const onSortingChange = vi.fn()
  const pagination: PaginationState = { pageIndex: 0, pageSize: 25 }
  const sorting: SortingState = []

  render(
    <DataTable<Row>
      columns={columns}
      data={[
        { id: 's1', name: 'Alpha' },
        { id: 's2', name: 'Beta' },
      ]}
      totalCount={2}
      pagination={pagination}
      onPaginationChange={onPaginationChange}
      sorting={sorting}
      onSortingChange={onSortingChange}
      {...overrides}
    />,
  )

  return { onPaginationChange, onSortingChange }
}

describe('DataTable', () => {
  it('renders rows and the total count summary', () => {
    renderTable()
    expect(screen.getByText('Alpha')).not.toBeNull()
    expect(screen.getByText('Beta')).not.toBeNull()
    expect(screen.getByText('Showing 1–2 of 2')).not.toBeNull()
  })

  it('shows the empty state when there are no rows', () => {
    renderTable({ data: [], totalCount: 0, emptyTitle: 'No sessions', emptyBody: 'Start one to see it here.' })
    expect(screen.getByText('No sessions')).not.toBeNull()
    expect(screen.getByText('Start one to see it here.')).not.toBeNull()
    expect(screen.getByText('No rows')).not.toBeNull()
  })

  it('toggles sorting when a sortable header is clicked', () => {
    const { onSortingChange } = renderTable()
    fireEvent.click(screen.getByRole('button', { name: /Name/ }))
    expect(onSortingChange).toHaveBeenCalledTimes(1)
  })

  it('does not make the non-sortable column header a button', () => {
    renderTable()
    expect(screen.queryByRole('button', { name: /^Id$/ })).toBeNull()
  })

  it('disables Previous on the first page and Next on the last page', () => {
    renderTable({ pagination: { pageIndex: 0, pageSize: 25 }, totalCount: 2 })
    const previous = screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement
    const next = screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement
    expect(previous.disabled).toBe(true)
    expect(next.disabled).toBe(true)
  })

  it('calls onPaginationChange with the next page index when Next is clicked', () => {
    const { onPaginationChange } = renderTable({
      totalCount: 60,
      pagination: { pageIndex: 0, pageSize: 25 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPaginationChange).toHaveBeenCalledTimes(1)
    const updater = onPaginationChange.mock.calls[0][0] as (p: PaginationState) => PaginationState
    expect(updater({ pageIndex: 0, pageSize: 25 })).toEqual({ pageIndex: 1, pageSize: 25 })
  })

  it('shows the correct page count for a given total and page size', () => {
    renderTable({ totalCount: 60, pagination: { pageIndex: 1, pageSize: 25 } })
    expect(screen.getByText('Page 2 of 3')).not.toBeNull()
  })

  it('invokes onRowClick with the row data', () => {
    const onRowClick = vi.fn()
    renderTable({ onRowClick })
    fireEvent.click(screen.getByText('Alpha'))
    expect(onRowClick).toHaveBeenCalledWith({ id: 's1', name: 'Alpha' })
  })
})
