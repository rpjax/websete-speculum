import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'

interface JsonTechnicalDetailsProps {
  data: unknown
  title?: string
}

export function JsonTechnicalDetails({ data, title = 'Technical details' }: JsonTechnicalDetailsProps) {
  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="tech">
        <AccordionTrigger>{title}</AccordionTrigger>
        <AccordionContent>
          <pre className="max-h-80 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
            {JSON.stringify(data, null, 2)}
          </pre>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
