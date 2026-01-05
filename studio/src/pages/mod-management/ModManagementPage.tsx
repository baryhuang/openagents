import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useProfileData } from '@/pages/profile/hooks/useProfileData';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useOpenAgents } from '@/context/OpenAgentsProvider';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/layout/ui/button';
import { Badge } from '@/components/layout/ui/badge';
import { Card, CardContent } from '@/components/layout/ui/card';
import { ScrollArea } from '@/components/layout/ui/scroll-area';
import { Lock, RefreshCw, Layers, CheckCircle, XCircle, Plus, Power, Loader2, Settings } from 'lucide-react';
import ModSettingsDialog from './ModSettingsDialog';
import RestartDialog from './RestartDialog';
import { getModsList, createApiOptions, restartNetwork } from '@/services/modManagementApi';
import { ModInfo } from '@/types/modConfig';

const ModManagementPage: React.FC = () => {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const { refresh } = useProfileData();
  const { isAdmin, isLoading: isCheckingAdmin } = useIsAdmin();
  const { connector } = useOpenAgents();
  const { agentName, selectedNetwork } = useAuthStore();

  const [refreshing, setRefreshing] = useState(false);
  const [modsList, setModsList] = useState<ModInfo[]>([]);
  const [loadingMod, setLoadingMod] = useState<string | null>(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [selectedMod, setSelectedMod] = useState<ModInfo | null>(null);
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load mods list from API
  const loadModsList = useCallback(async () => {
    const apiOptions = createApiOptions(selectedNetwork);
    if (!apiOptions) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const mods = await getModsList(apiOptions);
      setModsList(mods.mods);
    } catch (error: any) {
      console.error('Failed to load mods list:', error);
      toast.error(t('modManagement.loadModsFailed', 'Failed to load mods list') + ': ' + (error.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [selectedNetwork, t]);

  // Load mods on mount and when network changes
  useEffect(() => {
    if (selectedNetwork && isAdmin) {
      loadModsList();
    }
  }, [selectedNetwork, isAdmin, loadModsList]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadModsList();
    await refresh();
    setRefreshing(false);
  }, [loadModsList, refresh]);


  // Handle open settings dialog
  const handleOpenSettings = (mod: ModInfo) => {
    setSelectedMod(mod);
    setSettingsDialogOpen(true);
  };

  // Handle settings saved
  const handleSettingsSaved = () => {
    setRestartDialogOpen(true);
    refresh();
  };

  // Handle restart now
  const handleRestartNow = useCallback(async () => {
    const apiOptions = createApiOptions(selectedNetwork);
    if (!apiOptions) {
      toast.error(t('modManagement.restart.notConnected', 'Not connected to network'));
      return;
    }

    try {
      const result = await restartNetwork(apiOptions);
      // Show info message since manual restart is required
      toast.info(result.message || t('modManagement.restart.manualRestartRequired', 'Please manually restart the OpenAgents process to apply changes.'));
    } catch (error: any) {
      console.error('Failed to restart network:', error);
      toast.error(t('modManagement.restart.restartFailed', 'Failed to restart network') + ': ' + (error.message || 'Unknown error'));
    }
  }, [selectedNetwork, t]);

  // Handle toggle mod (enable/disable) - still using event system for now
  const handleToggleMod = useCallback(async (modId: string, currentEnabled: boolean) => {
    if (!connector) {
      toast.error(t('modManagement.loadMod.notConnected'));
      return;
    }

    setLoadingMod(modId);
    try {
      const response = await connector.sendEvent({
        event_name: currentEnabled ? 'system.mod.disable' : 'system.mod.enable',
        source_id: agentName || 'system',
        destination_id: 'system:system',
        payload: {
          mod_path: modId,
        },
      });

      if (response.success) {
        toast.success(currentEnabled
          ? t('modManagement.actions.disableSuccess', { modName: modId.split('.').pop() })
          : t('modManagement.actions.enableSuccess', { modName: modId.split('.').pop() })
        );
        setTimeout(() => {
          loadModsList();
          refresh();
        }, 500);
      } else {
        toast.error(t('modManagement.actions.toggleFailed', { error: response.message || 'Unknown error' }));
      }
    } catch (error: any) {
      console.error('Failed to toggle Mod:', error);
      toast.error(t('modManagement.actions.toggleFailed', { error: error.message || 'Unknown error' }));
    } finally {
      setLoadingMod(null);
    }
  }, [connector, agentName, loadModsList, refresh, t]);

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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t('modManagement.simpleTitle', 'Mod Management')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {t('modManagement.simpleSubtitle', 'Manage network mods')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => navigate('/admin/mods/add')}
              variant="primary"
              size="sm"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              {t('modManagement.addMod.button')}
            </Button>
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              variant="outline"
              size="sm"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? t('modManagement.loadedMods.refreshing') : t('modManagement.loadedMods.refresh')}
            </Button>
          </div>
        </div>

        {/* Enabled Mods Section */}
        <Card className="border-gray-200 dark:border-gray-700">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                  <Layers className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t('modManagement.enabledMods.title', 'Enabled Mods')}
                </h2>
              </div>
              <Badge variant="secondary" appearance="light" size="sm">
                {t('modManagement.enabledMods.total', 'Total')}: {modsList.length}
              </Badge>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('modManagement.loading', 'Loading mods...')}
                  </p>
                </div>
              </div>
            ) : modsList.length > 0 ? (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {modsList.map((mod) => {
                  const isLoading = loadingMod === mod.id;
                  return (
                    <div
                      key={mod.id}
                      className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {mod.enabled ? (
                          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                        ) : (
                          <XCircle className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium truncate ${
                              mod.enabled
                                ? 'text-gray-900 dark:text-gray-100'
                                : 'text-gray-500 dark:text-gray-400'
                            }`}>
                              {mod.displayName || mod.name || mod.id}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate mt-0.5">
                            {mod.id}
                          </div>
                          {/* Mod description */}
                          {mod.description && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {mod.description}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                        {mod.hasConfig && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenSettings(mod)}
                            disabled={isLoading || loadingMod !== null}
                            title={t('modManagement.actions.settings', '设置')}
                          >
                            <Settings className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant={mod.enabled ? "outline" : "primary"}
                          size="sm"
                          onClick={() => handleToggleMod(mod.id, mod.enabled)}
                          disabled={isLoading || loadingMod !== null}
                        >
                          {isLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <>
                              <Power className="w-3.5 h-3.5 mr-1" />
                              {mod.enabled
                                ? t('modManagement.actions.disable', 'Disable')
                                : t('modManagement.actions.enable', 'Enable')
                              }
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <Layers className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  {t('modManagement.enabledMods.empty', 'No mods configured')}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/admin/mods/add')}
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  {t('modManagement.addMod.button')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Settings Dialog */}
      {selectedMod && (
        <ModSettingsDialog
          open={settingsDialogOpen}
          onOpenChange={setSettingsDialogOpen}
          modId={selectedMod.id}
          modName={selectedMod.name || selectedMod.displayName || selectedMod.id}
          onSave={handleSettingsSaved}
        />
      )}

      {/* Restart Dialog */}
      <RestartDialog
        open={restartDialogOpen}
        onOpenChange={setRestartDialogOpen}
        onRestartNow={handleRestartNow}
        onRestartLater={() => {}}
      />
    </ScrollArea>
  );
};

export default ModManagementPage;
