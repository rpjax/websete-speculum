import { useMemo, useState } from 'react'

export interface PaginationState<T> {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  items: T[]
  setPage: (p: number) => void
  setPageSize: (s: number) => void
  canPrev: boolean
  canNext: boolean
}

export function usePagination<T>(allItems: T[], defaultPageSize = 25): PaginationState<T> {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeRaw] = useState(defaultPageSize)

  const totalItems = allItems.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  const safePage = Math.min(page, totalPages)

  const items = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return allItems.slice(start, start + pageSize)
  }, [allItems, safePage, pageSize])

  const setPageSize = (s: number) => {
    setPageSizeRaw(s)
    setPage(1)
  }

  return {
    page: safePage,
    pageSize,
    totalItems,
    totalPages,
    items,
    setPage,
    setPageSize,
    canPrev: safePage > 1,
    canNext: safePage < totalPages,
  }
}
