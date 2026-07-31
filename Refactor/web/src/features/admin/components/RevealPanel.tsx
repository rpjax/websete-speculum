import type { ReactNode } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'

export function RevealPanel({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode; variant?: 'accordion' | 'sheet' }) {
  return <Accordion type="single" collapsible defaultValue={defaultOpen ? 'panel' : undefined} className="rounded-lg border px-4"><AccordionItem value="panel" className="border-0"><AccordionTrigger>{title}</AccordionTrigger><AccordionContent>{children}</AccordionContent></AccordionItem></Accordion>
}
