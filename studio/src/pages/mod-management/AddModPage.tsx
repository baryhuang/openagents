import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useProfileData } from '@/pages/profile/hooks/useProfileData';
import { useAuthStore } from '@/stores/authStore';
import { useOpenAgents } from '@/context/OpenAgentsProvider';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { Button } from '@/components/layout/ui/button';
import { Badge } from '@/components/layout/ui/badge';
import { Card, CardContent } from '@/components/layout/ui/card';
import { ScrollArea } from '@/components/layout/ui/scroll-area';
import {
  Lock,
  ArrowLeft,
  Plus,
  Loader2,
  MessageSquare,
  Users,
  FileText,
  Folder,
  Globe,
  Gamepad2,
  Search,
  CheckCircle,
  Layers
} from 'lucide-react';
import { getModsList, createApiOptions } from '@/services/modManagementApi';

interface StaticModInfo {
  name: string;
  enabled: boolean;
  config?: Record<string, any>;
}

interface DynamicModInfo {
  mod_id: string;
  mod_path: string;
  loaded_at: string;
}

// Available mods in OpenAgents
interface AvailableMod {
  id: string;
  name: string;
  path: string;
  description: string;
  category: string;
  icon: React.ReactNode;
}

// Get category from mod path
const getModCategory = (path: string): string => {
  const parts = path.split('.');
  if (parts.length >= 3) {
    const categoryPart = parts[2]; // e.g., "workspace", "communication", "discovery"
    return categoryPart.charAt(0).toUpperCase() + categoryPart.slice(1);
  }
  return 'Other';
};

// Icon mapping based on mod path
const getModIcon = (path: string): React.ReactNode => {
  const pathLower = path.toLowerCase();
  if (pathLower.includes('messaging') || pathLower.includes('forum')) {
    return <MessageSquare className="w-5 h-5" />;
  }
  if (pathLower.includes('discovery') || pathLower.includes('search')) {
    return <Search className="w-5 h-5" />;
  }
  if (pathLower.includes('delegation') || pathLower.includes('coordination')) {
    return <Users className="w-5 h-5" />;
  }
  if (pathLower.includes('wiki')) {
    return <Globe className="w-5 h-5" />;
  }
  if (pathLower.includes('document') || pathLower.includes('feed')) {
    return <FileText className="w-5 h-5" />;
  }
  if (pathLower.includes('cache') || pathLower.includes('artifact') || pathLower.includes('project')) {
    return <Folder className="w-5 h-5" />;
  }
  if (pathLower.includes('game') || pathLower.includes('agentworld')) {
    return <Gamepad2 className="w-5 h-5" />;
  }
  // Default icon
  return <Layers className="w-5 h-5" />;
};

const AddModPage: React.FC = () => {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const { agentName, selectedNetwork } = useAuthStore();
  const { connector } = useOpenAgents();
  const { healthData, refresh } = useProfileData();
  const { isAdmin, isLoading: isCheckingAdmin } = useIsAdmin();

  const [staticMods, setStaticMods] = useState<StaticModInfo[]>([]);
  const [dynamicMods, setDynamicMods] = useState<DynamicModInfo[]>([]);
  const [loadingMod, setLoadingMod] = useState<string | null>(null);
  const [availableMods, setAvailableMods] = useState<AvailableMod[]>([]);
  const [loadingAvailableMods, setLoadingAvailableMods] = useState(false);

  // Load available mods from API
  const loadAvailableMods = useCallback(async () => {
    const apiOptions = createApiOptions(selectedNetwork);
    if (!apiOptions) {
      return;
    }

    try {
      setLoadingAvailableMods(true);
      const response = await getModsList(apiOptions);
      // Convert ModInfo to AvailableMod format
      const modsWithIcons: AvailableMod[] = response.mods.map((mod) => ({
        id: mod.id,
        name: mod.displayName || mod.name.split('.').pop() || mod.id,
        path: mod.name, // mod.name is the full path like "openagents.mods.workspace.messaging"
        description: mod.description || '',
        category: getModCategory(mod.name),
        icon: getModIcon(mod.name),
      }));
      setAvailableMods(modsWithIcons);
    } catch (error: any) {
      console.error('Failed to load available mods:', error);
      toast.error(
        t('modManagement.loadAvailableModsFailed', 'Failed to load available mods') +
          ': ' +
          (error.message || 'Unknown error')
      );
    } finally {
      setLoadingAvailableMods(false);
    }
  }, [selectedNetwork, t]);

  // Extract mods information from healthData
  useEffect(() => {
    if (healthData?.data?.mods) {
      setStaticMods(healthData.data.mods as StaticModInfo[]);
    } else {
      setStaticMods([]);
    }
    // Extract dynamic mods (loaded at runtime)
    // dynamic_mods is an object with {loaded: [], count: number, details: {}}
    if (healthData?.data?.dynamic_mods?.loaded && Array.isArray(healthData.data.dynamic_mods.loaded)) {
      const details = healthData.data.dynamic_mods.details || {};
      const dynamicModsList: DynamicModInfo[] = healthData.data.dynamic_mods.loaded.map((modId: string) => ({
        mod_id: modId,
        mod_path: details[modId]?.mod_path || modId,
        loaded_at: details[modId]?.loaded_at || '',
      }));
      setDynamicMods(dynamicModsList);
    } else {
      setDynamicMods([]);
    }
  }, [healthData]);

  // Load available mods when component mounts or network changes
  useEffect(() => {
    if (isAdmin) {
      loadAvailableMods();
    }
  }, [isAdmin, loadAvailableMods]);

  // Check if a mod is already enabled (either static or dynamic)
  const isModEnabled = useCallback((modPath: string) => {
    // Check in static mods
    const isStatic = staticMods.some(m => m.name === modPath && m.enabled);
    // Check in dynamic mods
    const isDynamic = dynamicMods.some(m => m.mod_path === modPath);
    return isStatic || isDynamic;
  }, [staticMods, dynamicMods]);

  // Handle loading a mod dynamically
  const handleLoadMod = useCallback(async (mod: AvailableMod) => {
    if (!connector) {
      toast.error(t('modManagement.loadMod.notConnected'));
      return;
    }

    setLoadingMod(mod.id);
    try {
      const response = await connector.sendEvent({
        event_name: 'system.mod.load',
        source_id: agentName || 'system',
        destination_id: 'system:system',
        payload: {
          mod_path: mod.path,
          config: {},
        },
      });

      if (response.success) {
        toast.success(t('modManagement.loadMod.loadSuccess', { modId: mod.name }));
        // Refresh data
        setTimeout(() => {
          refresh();
        }, 500);
      } else {
        toast.error(t('modManagement.loadMod.loadFailed', { error: response.message || 'Unknown error' }));
      }
    } catch (error: any) {
      console.error('Failed to load Mod:', error);
      toast.error(t('modManagement.loadMod.loadFailed', { error: error.message || 'Unknown error' }));
    } finally {
      setLoadingMod(null);
    }
  }, [connector, agentName, refresh, t]);

  // Group available mods by category
  const modsByCategory = availableMods.reduce((acc, mod) => {
    if (!acc[mod.category]) {
      acc[mod.category] = [];
    }
    acc[mod.category].push(mod);
    return acc;
  }, {} as Record<string, AvailableMod[]>);

  // Check admin permission
  if (isCheckingAdmin) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('modManagement.checkingPermissions')}
          </p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-center max-w-md mx-auto">
          <div className="mb-6">
            <Lock className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-500" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            {t('modManagement.accessDenied')}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            {t('modManagement.adminOnly')}
          </p>
          <Button
            variant="outline"
            onClick={() => window.history.back()}
          >
            {t('modManagement.goBack')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin/mods')}
            className="p-2"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t('modManagement.addMod.pageTitle')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {t('modManagement.addMod.pageDescription')}
            </p>
          </div>
        </div>

        {/* Mods by Category */}
        {loadingAvailableMods ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('modManagement.loadingAvailableMods', 'Loading available mods...')}
              </p>
            </div>
          </div>
        ) : Object.keys(modsByCategory).length === 0 ? (
          <div className="text-center py-12">
            <Layers className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('modManagement.noAvailableMods', 'No available mods found')}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(modsByCategory).map(([category, mods]) => (
            <div key={category}>
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
                {category}
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
                {mods.map((mod) => {
                  const enabled = isModEnabled(mod.path);
                  const isLoading = loadingMod === mod.id;
                  return (
                    <Card
                      key={mod.id}
                      className={`border transition-colors ${
                        enabled
                          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                          : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'
                      }`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={`p-2.5 rounded-lg flex-shrink-0 ${
                            enabled
                              ? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                          }`}>
                            {mod.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-gray-900 dark:text-gray-100">
                                {mod.id}
                              </span>
                              {enabled && (
                                <Badge variant="success" appearance="light" size="sm">
                                  <CheckCircle className="w-3 h-3 mr-1" />
                                  {t('modManagement.addMod.enabled')}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                              {mod.description}
                            </p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate mb-3">
                              {mod.path}
                            </p>
                            {!enabled && (
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => handleLoadMod(mod)}
                                disabled={isLoading || loadingMod !== null}
                                className="w-full"
                              >
                                {isLoading ? (
                                  <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    {t('modManagement.addMod.loading')}
                                  </>
                                ) : (
                                  <>
                                    <Plus className="w-4 h-4 mr-2" />
                                    {t('modManagement.addMod.add')}
                                  </>
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
};

export default AddModPage;
