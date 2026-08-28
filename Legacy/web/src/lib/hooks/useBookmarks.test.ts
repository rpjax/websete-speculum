import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBookmarks } from './useBookmarks'

vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 8) })

describe('useBookmarks', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts with empty bookmarks', () => {
    const { result } = renderHook(() => useBookmarks())
    expect(result.current.bookmarks).toEqual([])
  })

  it('adds a bookmark', () => {
    const { result } = renderHook(() => useBookmarks())
    act(() => {
      result.current.addBookmark('event', 'evt-123', 'Test event')
    })
    expect(result.current.bookmarks).toHaveLength(1)
    expect(result.current.bookmarks[0].type).toBe('event')
    expect(result.current.bookmarks[0].targetId).toBe('evt-123')
    expect(result.current.bookmarks[0].label).toBe('Test event')
  })

  it('prevents duplicate bookmarks', () => {
    const { result } = renderHook(() => useBookmarks())
    act(() => {
      result.current.addBookmark('session', 'sess-1', 'Session A')
    })
    act(() => {
      result.current.addBookmark('session', 'sess-1', 'Session A again')
    })
    expect(result.current.bookmarks).toHaveLength(1)
  })

  it('allows same targetId with different type', () => {
    const { result } = renderHook(() => useBookmarks())
    act(() => {
      result.current.addBookmark('event', 'id-1', 'As event')
    })
    act(() => {
      result.current.addBookmark('story', 'id-1', 'As story')
    })
    expect(result.current.bookmarks).toHaveLength(2)
  })

  it('removes a bookmark', () => {
    const { result } = renderHook(() => useBookmarks())
    act(() => {
      result.current.addBookmark('event', 'evt-1', 'E1')
      result.current.addBookmark('event', 'evt-2', 'E2')
    })
    act(() => {
      result.current.removeBookmark('evt-1', 'event')
    })
    expect(result.current.bookmarks).toHaveLength(1)
    expect(result.current.bookmarks[0].targetId).toBe('evt-2')
  })

  it('isBookmarked checks type and targetId', () => {
    const { result } = renderHook(() => useBookmarks())
    act(() => {
      result.current.addBookmark('session', 'sess-x', 'X')
    })
    expect(result.current.isBookmarked('sess-x', 'session')).toBe(true)
    expect(result.current.isBookmarked('sess-x', 'event')).toBe(false)
    expect(result.current.isBookmarked('sess-y', 'session')).toBe(false)
  })

  it('clearBookmarks removes all and clears storage', () => {
    const { result } = renderHook(() => useBookmarks())
    act(() => {
      result.current.addBookmark('event', 'e1', 'E1')
      result.current.addBookmark('event', 'e2', 'E2')
    })
    act(() => {
      result.current.clearBookmarks()
    })
    expect(result.current.bookmarks).toEqual([])
    expect(localStorage.getItem('speculum-bookmarks')).toBeNull()
  })

  it('persists bookmarks to localStorage', () => {
    const { result } = renderHook(() => useBookmarks())
    act(() => {
      result.current.addBookmark('session', 's1', 'Session 1')
    })
    const stored = JSON.parse(localStorage.getItem('speculum-bookmarks')!)
    expect(stored).toHaveLength(1)
    expect(stored[0].targetId).toBe('s1')
  })

  it('loads bookmarks from localStorage on mount', () => {
    localStorage.setItem('speculum-bookmarks', JSON.stringify([
      { id: 'bm-1', type: 'event', label: 'Existing', targetId: 'evt-old', timestamp: '2025-01-01T00:00:00Z' },
    ]))
    const { result } = renderHook(() => useBookmarks())
    expect(result.current.bookmarks).toHaveLength(1)
    expect(result.current.bookmarks[0].label).toBe('Existing')
  })

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('speculum-bookmarks', 'not-valid-json')
    const { result } = renderHook(() => useBookmarks())
    expect(result.current.bookmarks).toEqual([])
  })
})
