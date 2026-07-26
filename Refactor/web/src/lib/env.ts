export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export const MOCK_MODE = import.meta.env.VITE_MOCK === '1'
