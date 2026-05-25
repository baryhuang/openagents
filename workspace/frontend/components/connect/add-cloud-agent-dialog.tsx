'use client';

import { useState, useEffect, useMemo } from 'react';
import { Loader2, Cloud, Image as ImageIcon, MessageSquare } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { CloudAgentProvider, CloudAgentModel } from '@/lib/types';

interface AddCloudAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProvider?: string;
  onAdded?: () => void;
}

export function AddCloudAgentDialog({
  open,
  onOpenChange,
  initialProvider,
  onAdded,
}: AddCloudAgentDialogProps) {
  const { refreshWorkspace } = useWorkspace();
  const [providers, setProviders] = useState<CloudAgentProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedProvider, setSelectedProvider] = useState<string>(initialProvider || '');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [agentName, setAgentName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    workspaceApi
      .getCloudProviders()
      .then(setProviders)
      .catch(() => toast.error('Failed to load providers'))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (initialProvider && open) {
      setSelectedProvider(initialProvider);
    }
  }, [initialProvider, open]);

  const currentProvider = useMemo(
    () => providers.find((p) => p.name === selectedProvider),
    [providers, selectedProvider],
  );

  const currentModel = useMemo(
    () => currentProvider?.models.find((m) => m.id === selectedModel),
    [currentProvider, selectedModel],
  );

  useEffect(() => {
    if (currentProvider && currentProvider.models.length > 0 && !selectedModel) {
      setSelectedModel(currentProvider.models[0].id);
    }
  }, [currentProvider, selectedModel]);

  useEffect(() => {
    if (currentModel) {
      const base = currentModel.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      setAgentName(base);
    }
  }, [currentModel]);

  const handleSubmit = async () => {
    if (!selectedProvider || !selectedModel || !agentName || !apiKey) {
      toast.error('Please fill in all required fields');
      return;
    }

    setSaving(true);
    try {
      await workspaceApi.addCloudAgent({
        agentName,
        provider: selectedProvider,
        model: selectedModel,
        apiKey,
        systemPrompt: systemPrompt || undefined,
      });
      toast.success(`Cloud agent "${agentName}" added`);
      refreshWorkspace();
      onAdded?.();
      onOpenChange(false);
      setSelectedProvider('');
      setSelectedModel('');
      setAgentName('');
      setApiKey('');
      setSystemPrompt('');
      setShowAdvanced(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add cloud agent';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="size-4" />
            Add Cloud Agent
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Provider */}
            <div className="space-y-1.5">
              <Label className="text-xs">Provider</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {providers.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => {
                      setSelectedProvider(p.name);
                      setSelectedModel('');
                    }}
                    className={cn(
                      'px-3 py-2 rounded-md border text-xs font-medium transition-colors text-left',
                      selectedProvider === p.name
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Model */}
            {currentProvider && (
              <div className="space-y-1.5">
                <Label className="text-xs">Model</Label>
                <div className="space-y-1">
                  {currentProvider.models.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedModel(m.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 rounded-md border text-xs transition-colors text-left',
                        selectedModel === m.id
                          ? 'border-primary bg-primary/5'
                          : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600',
                      )}
                    >
                      {m.category === 'image' ? (
                        <ImageIcon className="size-3.5 text-violet-500 shrink-0" />
                      ) : (
                        <MessageSquare className="size-3.5 text-blue-500 shrink-0" />
                      )}
                      <span className="font-medium">{m.label}</span>
                      <span className="text-muted-foreground ml-auto">
                        {m.category === 'image' ? 'Image' : 'Chat'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Agent name */}
            <div className="space-y-1.5">
              <Label htmlFor="agent-name" className="text-xs">Agent Name</Label>
              <Input
                id="agent-name"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. chatgpt, dall-e"
                className="text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                This is how you&apos;ll @mention the agent in chat.
              </p>
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <Label htmlFor="api-key" className="text-xs">API Key</Label>
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="text-sm font-mono"
              />
            </div>

            {/* Advanced */}
            <div>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAdvanced ? 'Hide' : 'Show'} advanced options
              </button>
              {showAdvanced && (
                <div className="mt-2 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="system-prompt" className="text-xs">System Prompt (optional)</Label>
                    <Textarea
                      id="system-prompt"
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      placeholder="Custom instructions for this agent..."
                      className="text-sm min-h-[60px]"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !selectedProvider || !selectedModel || !agentName || !apiKey}
          >
            {saving && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
            Add Agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
