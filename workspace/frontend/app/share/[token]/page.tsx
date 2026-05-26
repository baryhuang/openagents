'use client';

import { useEffect, useState, use } from 'react';
import Image from 'next/image';
import Avatar from 'boring-avatars';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { Loader2 } from 'lucide-react';
import type { SharedSnapshotMessage } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://workspace-endpoint.openagents.org';

const OA_PALETTE = ['#6C5CE7', '#A29BFE', '#74B9FF', '#0984E3', '#00CEC9'];

interface SnapshotData {
  id: string;
  title: string | null;
  messages: SharedSnapshotMessage[];
  message_count: number;
  created_at: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SenderAvatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <div className="rounded-full overflow-hidden shrink-0" style={{ width: size, height: size }}>
      <Avatar name={name} size={size} variant="beam" colors={OA_PALETTE} />
    </div>
  );
}

function SharedMessage({ message }: { message: SharedSnapshotMessage }) {
  const isHuman = message.sender_type === 'human';

  return (
    <div className={`flex gap-3 py-4 ${isHuman ? '' : 'bg-muted/30'} px-4 sm:px-6`}>
      <SenderAvatar name={message.sender_name} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-semibold text-sm">{message.sender_name}</span>
          {message.created_at && (
            <span className="text-xs text-muted-foreground">{formatDate(message.created_at)}</span>
          )}
        </div>
        <div className="prose prose-sm dark:prose-invert max-w-none break-words">
          <MarkdownContent content={message.content} agentNames={[]} />
        </div>
      </div>
    </div>
  );
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_URL}/v1/shares/public/${token}`);
        if (!res.ok) {
          setError('This shared conversation could not be found or has been removed.');
          return;
        }
        const json = await res.json();
        if (json.code !== 0) {
          setError(json.message || 'Share not found');
          return;
        }
        setSnapshot(json.data);
      } catch {
        setError('Failed to load shared conversation.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background gap-4">
        <Image src="/logo-icon.png" alt="OpenAgents" width={40} height={40} />
        <h1 className="text-xl font-semibold">Shared Conversation</h1>
        <p className="text-muted-foreground text-sm max-w-md text-center">{error}</p>
        <a
          href="https://openagents.org"
          className="text-sm text-primary hover:underline"
        >
          Go to OpenAgents
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/logo-icon.png" alt="OpenAgents" width={24} height={24} />
            <span className="text-sm font-medium text-muted-foreground">Shared Conversation</span>
          </div>
          <a
            href="https://openagents.org"
            className="text-sm text-primary hover:underline"
          >
            OpenAgents
          </a>
        </div>
      </header>

      {/* Title */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 border-b">
        <h1 className="text-xl font-semibold">{snapshot.title || 'Shared Conversation'}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {snapshot.message_count} message{snapshot.message_count !== 1 ? 's' : ''}
          {snapshot.created_at && ` · Shared ${formatDate(snapshot.created_at)}`}
        </p>
      </div>

      {/* Messages */}
      <div className="max-w-3xl mx-auto divide-y">
        {snapshot.messages.map((msg, i) => (
          <SharedMessage key={i} message={msg} />
        ))}
      </div>

      {/* Footer */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 text-center border-t mt-8">
        <p className="text-sm text-muted-foreground mb-3">
          This is a snapshot of a conversation on OpenAgents.
        </p>
        <a
          href="https://openagents.org"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          <Image src="/logo-icon.png" alt="" width={16} height={16} />
          Try OpenAgents
        </a>
      </div>
    </div>
  );
}
