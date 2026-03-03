'use client';

import { use, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkspaceProvider } from '@/lib/workspace-context';
import { LayoutProvider } from '@/components/layout/layout-context';
import { Wrapper } from '@/components/layout/wrapper';

function WorkspaceContent({ workspaceId }: { workspaceId: string }) {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  if (!token) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 bg-background">
        <h1 className="text-xl font-semibold text-destructive">Missing Token</h1>
        <p className="text-muted-foreground text-sm">
          Add <code className="bg-muted px-2 py-0.5 rounded">?token=your_workspace_token</code> to the URL.
        </p>
      </div>
    );
  }

  return (
    <WorkspaceProvider workspaceId={workspaceId} token={token}>
      <LayoutProvider>
        <Wrapper />
      </LayoutProvider>
    </WorkspaceProvider>
  );
}

export default function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = use(params);

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <WorkspaceContent workspaceId={workspaceId} />
    </Suspense>
  );
}
