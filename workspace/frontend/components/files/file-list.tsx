'use client';

import { useRef, useState } from 'react';
import {
  Search, Upload, FolderOpen, FileText, FileCode, Image,
  File as FileIcon, Trash2,
} from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(contentType: string, filename: string) {
  if (contentType.startsWith('image/')) return <Image className="size-4 text-purple-500" />;
  if (contentType.startsWith('text/') || filename.match(/\.(md|txt|csv)$/i))
    return <FileText className="size-4 text-blue-500" />;
  if (
    filename.match(/\.(js|ts|tsx|jsx|py|rs|go|java|rb|c|cpp|h|sh|yaml|yml|json|toml)$/i) ||
    contentType.includes('javascript') ||
    contentType.includes('json')
  )
    return <FileCode className="size-4 text-emerald-500" />;
  return <FileIcon className="size-4 text-zinc-400" />;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function FileList() {
  const { files, selectedFileId, setSelectedFileId, uploadFile, deleteFile, refreshFiles } = useWorkspace();
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = search
    ? files.filter((f) => f.filename.toLowerCase().includes(search.toLowerCase()))
    : files;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadFile(file);
      toast.success(`Uploaded ${file.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (e: React.MouseEvent, fileId: string, filename: string) => {
    e.stopPropagation();
    try {
      await deleteFile(fileId);
      toast.success(`Deleted ${filename}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-3 shrink-0">
        <div className="flex items-center w-full gap-1">
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50 border border-input text-muted-foreground">
            <Search className="size-3.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files..."
              className="text-xs bg-transparent outline-none flex-1 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0 disabled:opacity-50"
            title="Upload File"
          >
            <Upload className="size-3.5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleUpload}
          />
        </div>
      </div>

      {/* File list */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <FolderOpen className="size-10 mx-auto opacity-30" />
            <p className="text-sm font-medium">{files.length === 0 ? 'No files yet' : 'No matches'}</p>
            <p className="text-xs">
              {files.length === 0 ? 'Upload a file or ask an agent to create one' : 'Try a different search term'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-1">
          {filtered.map((file) => (
            <button
              key={file.id}
              onClick={() => setSelectedFileId(file.id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors group',
                selectedFileId === file.id
                  ? 'bg-zinc-100 dark:bg-zinc-800'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
              )}
            >
              {getFileIcon(file.contentType, file.filename)}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate">{file.filename}</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatSize(file.size)} · {file.uploadedBy.replace(/^(openagents:|human:)/, '')}
                  {file.createdAt && ` · ${timeAgo(file.createdAt)}`}
                </p>
              </div>
              <button
                onClick={(e) => handleDelete(e, file.id, file.filename)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-muted-foreground hover:text-red-500 transition-all"
                title="Delete"
              >
                <Trash2 className="size-3.5" />
              </button>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
