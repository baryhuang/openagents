'use client';

import { FileText } from 'lucide-react';

export function FilePreview() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
      <div className="opacity-20 mb-3">
        <FileText className="size-10" />
      </div>
      <p className="text-sm font-medium">Select a file</p>
      <p className="text-xs mt-1">Choose a file from the list to preview.</p>
    </div>
  );
}
