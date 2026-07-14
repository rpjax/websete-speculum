import { describe, expect, it } from 'vitest'

function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalItems = items.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  return {
    page: safePage,
    pageSize,
    totalItems,
    totalPages,
    items: items.slice(start, start + pageSize),
    canPrev: safePage > 1,
    canNext: safePage < totalPages,
  }
}

describe('pagination logic', () => {
  const items = Array.from({ length: 75 }, (_, i) => i)

  it('returns first page of items', () => {
    const result = paginate(items, 1, 25)
    expect(result.page).toBe(1)
    expect(result.items).toHaveLength(25)
    expect(result.items[0]).toBe(0)
    expect(result.totalPages).toBe(3)
    expect(result.totalItems).toBe(75)
  })

  it('navigates to next page', () => {
    const result = paginate(items, 2, 25)
    expect(result.page).toBe(2)
    expect(result.items[0]).toBe(25)
  })

  it('last page has remaining items', () => {
    const result = paginate(items, 3, 25)
    expect(result.items).toHaveLength(25)
  })

  it('reports canPrev and canNext correctly', () => {
    expect(paginate(items, 1, 25).canPrev).toBe(false)
    expect(paginate(items, 1, 25).canNext).toBe(true)
    expect(paginate(items, 2, 25).canPrev).toBe(true)
    expect(paginate(items, 2, 25).canNext).toBe(true)
    expect(paginate(items, 3, 25).canPrev).toBe(true)
    expect(paginate(items, 3, 25).canNext).toBe(false)
  })

  it('handles empty array', () => {
    const result = paginate([], 1, 25)
    expect(result.page).toBe(1)
    expect(result.totalPages).toBe(1)
    expect(result.items).toHaveLength(0)
  })

  it('clamps page when items shrink', () => {
    const result = paginate([1, 2, 3], 3, 25)
    expect(result.page).toBe(1)
  })

  it('adjusts page size correctly', () => {
    const result = paginate(items, 1, 50)
    expect(result.totalPages).toBe(2)
    expect(result.items).toHaveLength(50)
  })
})
