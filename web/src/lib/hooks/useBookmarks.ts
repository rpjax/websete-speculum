import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'speculum-bookmarks'

export interface Bookmark {
  id: string
  type: 'story' | 'event' | 'session'
  label: string
  targetId: string
  timestamp: string
  note?: string
}

function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Bookmark[]) : []
  } catch {
    return []
  }
}

function persistBookmarks(bookmarks: Bookmark[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks))
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadBookmarks)

  useEffect(() => {
    setBookmarks(loadBookmarks())
  }, [])

  const addBookmark = useCallback((type: Bookmark['type'], targetId: string, label: string, note?: string) => {
    setBookmarks((prev) => {
      if (prev.some((b) => b.targetId === targetId && b.type === type)) return prev
      const next = [
        { id: crypto.randomUUID(), type, label, targetId, timestamp: new Date().toISOString(), note },
        ...prev,
      ]
      persistBookmarks(next)
      return next
    })
  }, [])

  const removeBookmark = useCallback((targetId: string, type: Bookmark['type']) => {
    setBookmarks((prev) => {
      const next = prev.filter((b) => !(b.targetId === targetId && b.type === type))
      persistBookmarks(next)
      return next
    })
  }, [])

  const isBookmarked = useCallback((targetId: string, type: Bookmark['type']) => {
    return bookmarks.some((b) => b.targetId === targetId && b.type === type)
  }, [bookmarks])

  const clearBookmarks = useCallback(() => {
    setBookmarks([])
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return { bookmarks, addBookmark, removeBookmark, isBookmarked, clearBookmarks }
}
