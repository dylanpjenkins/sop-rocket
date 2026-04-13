import { Button } from '@/components/ui/button'
import { FileText, Plus } from 'lucide-react'

interface EmptyStateProps {
  onNewSOP: () => void
}

export function EmptyState({ onNewSOP }: EmptyStateProps) {
  return (
    <div className="flex min-h-full w-full flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="rounded-full bg-muted p-4">
        <FileText className="h-10 w-10 text-muted-foreground" />
      </div>
      <p className="text-muted-foreground max-w-sm">
        Select an SOP from the library or create a new one.
      </p>
      <Button onClick={onNewSOP}>
        <Plus className="h-4 w-4 mr-2" />
        New SOP
      </Button>
    </div>
  )
}
