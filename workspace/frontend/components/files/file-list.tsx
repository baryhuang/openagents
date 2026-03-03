'use client';

import { Search, Upload, FolderOpen } from 'lucide-react';

export function FileList() {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-3 shrink-0">
        <div className="flex items-center w-full gap-1">
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50 border border-input text-muted-foreground">
            <Search className="size-3.5" />
            <span className="text-xs">Search files...</span>
          </div>
          <button
            className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0"
            title="Upload File"
          >
            <Upload className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Empty state */}
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <FolderOpen className="size-10 mx-auto opacity-30" />
          <p className="text-sm font-medium">No files yet</p>
          <p className="text-xs">Files shared in threads will appear here</p>
        </div>
      </div>
    </div>
  );
}
