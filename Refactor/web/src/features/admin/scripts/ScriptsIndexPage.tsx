import { useSearchParams } from 'react-router-dom'
import { InjectionsPage } from './InjectionsPage'
import { LibraryPage } from './LibraryPage'

export function ScriptsIndexPage() {
  const [params] = useSearchParams()
  return params.get('tab') === 'injections' ? <InjectionsPage /> : <LibraryPage />
}
