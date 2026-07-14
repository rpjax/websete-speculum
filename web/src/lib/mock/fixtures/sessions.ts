import type { SessionMeta, SessionDetail, ScriptMeta } from '@/lib/api'

const now = new Date().toISOString()
const yesterday = new Date(Date.now() - 86_400_000).toISOString()
const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString()

export const sessionsList: SessionMeta[] = [
  {
    sessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    clientToken: 'ctkn-aaaa-bbbb-cccc-dddd-eeeeeeee',
    updatedAt: now,
    expiresAt: nextWeek,
    cookieCount: 12,
    localStorageCount: 4,
    idbRecordCount: 2,
    historyCount: 7,
  },
  {
    sessionId: 'sess-22222222-3333-4444-5555-666666666666',
    clientToken: 'ctkn-2222-3333-4444-5555-66666666',
    updatedAt: yesterday,
    expiresAt: nextWeek,
    cookieCount: 3,
    localStorageCount: 0,
    idbRecordCount: 0,
    historyCount: 2,
  },
  {
    sessionId: 'sess-x9y8z7w6-v5u4-3210-fedc-ba9876543210',
    clientToken: 'ctkn-x9y8-z7w6-v5u4-3210-fedcba98',
    updatedAt: now,
    expiresAt: nextWeek,
    cookieCount: 1,
    localStorageCount: 1,
    idbRecordCount: 0,
    historyCount: 0,
  },
]

export function sessionDetail(sessionId: string): SessionDetail {
  return {
    sessionId,
    clientToken: sessionsList.find((s) => s.sessionId === sessionId)?.clientToken ?? 'ctkn-unknown',
    cookies: [
      { name: '_ga', domain: '.example.com', path: '/', value: 'GA1.2.123456789.1710000000' },
      { name: 'session_id', domain: 'www.example.com', path: '/', value: 'abc123def456' },
      { name: 'consent', domain: '.example.com', path: '/', value: 'analytics=1;marketing=0' },
    ],
    localStorage: [
      { origin: 'https://www.example.com', key: 'theme', value: 'dark' },
      { origin: 'https://www.example.com', key: 'lang', value: 'en' },
    ],
    idbRecords: [
      {
        origin: 'https://www.example.com',
        databaseName: 'appCache',
        storeName: 'pages',
        keyJson: '{"url":"/home"}',
      },
    ],
    history: [
      { url: 'https://www.example.com/', title: 'Example Home', indexOrder: 0 },
      { url: 'https://www.example.com/products', title: 'Products', indexOrder: 1 },
      { url: 'https://www.example.com/cart', title: 'Cart', indexOrder: 2 },
    ],
  }
}

export const scriptsList: ScriptMeta[] = [
  {
    id: 'scr-001',
    name: 'analytics-override.js',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb924' + '27ae41e4649b934ca495991b7852b855',
    size: 1245,
    uploadedAt: yesterday,
  },
  {
    id: 'scr-002',
    name: 'consent-banner.js',
    sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' + 'e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    size: 3890,
    uploadedAt: now,
  },
]
