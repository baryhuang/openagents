import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useOpenAgents } from '@/context/OpenAgentsProvider';
import { useAuthStore } from '@/stores/authStore';
import { ConfigSchema, SaveConfigResponse } from '@/types/modConfig';
import ConfigFieldRenderer from './ConfigFieldRenderer';

// Mock schema data for testing (will be replaced by actual manifest data)
const getMockSchema = (modName: string): ConfigSchema | null => {
  if (modName.includes('messaging')) {
    return {
      sections: [
        {
          id: 'general',
          title: '常规设置',
          fields: [
            {
              key: 'max_message_history',
              type: 'number',
              label: '最大消息历史',
              description: '保留的最大消息数量',
              default: 10000,
              min: 1,
              max: 1000000,
            },
            {
              key: 'message_retention_days',
              type: 'number',
              label: '消息保留天数',
              description: '消息保留的天数',
              default: 180,
              min: 1,
              max: 3650,
            },
            {
              key: 'enable_thread_replies',
              type: 'boolean',
              label: '启用线程回复',
              description: '允许在消息中创建线程回复',
              default: true,
            },
          ],
        },
        {
          id: 'fileUpload',
          title: '文件上传',
          fields: [
            {
              key: 'max_file_size',
              type: 'number',
              label: '最大文件大小 (字节)',
              description: '允许上传的最大文件大小',
              default: 10485760,
              min: 1024,
              max: 1073741824,
            },
            {
              key: 'allowed_file_types',
              type: 'multiselect',
              label: '允许的文件类型',
              description: '允许上传的文件扩展名',
              default: ['txt', 'md', 'py', 'json'],
              options: [
                { value: 'txt', label: 'txt' },
                { value: 'md', label: 'md' },
                { value: 'py', label: 'py' },
                { value: 'json', label: 'json' },
                { value: 'yaml', label: 'yaml' },
                { value: 'pdf', label: 'pdf' },
                { value: 'jpg', label: 'jpg' },
                { value: 'png', label: 'png' },
                { value: 'csv', label: 'csv' },
                { value: 'xlsx', label: 'xlsx' },
              ],
            },
          ],
        },
      ],
    };
  }

  if (modName.includes('documents')) {
    return {
      sections: [
        {
          id: 'general',
          title: '常规设置',
          fields: [
            {
              key: 'max_document_size',
              type: 'number',
              label: '最大文档大小 (字节)',
              description: '单个文档的最大大小',
              default: 10485760,
              min: 1024,
              max: 1073741824,
            },
            {
              key: 'max_documents_per_agent',
              type: 'number',
              label: '每个代理最大文档数',
              description: '每个代理可以创建的最大文档数量',
              default: 100,
              min: 1,
              max: 10000,
            },
            {
              key: 'document_retention_days',
              type: 'number',
              label: '文档保留天数',
              description: '文档保留的天数',
              default: 365,
              min: 1,
              max: 3650,
            },
          ],
        },
        {
          id: 'collaboration',
          title: '协作设置',
          fields: [
            {
              key: 'max_concurrent_editors',
              type: 'number',
              label: '最大并发编辑者',
              description: '同时编辑文档的最大用户数',
              default: 50,
              min: 1,
              max: 1000,
            },
            {
              key: 'line_lock_timeout',
              type: 'number',
              label: '行锁定超时 (秒)',
              description: '行锁定的超时时间',
              default: 30,
              min: 5,
              max: 300,
            },
            {
              key: 'presence_timeout',
              type: 'number',
              label: '在线状态超时 (秒)',
              description: '用户在线状态的超时时间',
              default: 300,
              min: 60,
              max: 3600,
            },
          ],
        },
        {
          id: 'versioning',
          title: '版本控制',
          fields: [
            {
              key: 'max_version_history',
              type: 'number',
              label: '最大版本历史',
              description: '保留的最大版本数量',
              default: 1000,
              min: 1,
              max: 10000,
            },
            {
              key: 'auto_save_interval',
              type: 'number',
              label: '自动保存间隔 (秒)',
              description: '自动保存的时间间隔',
              default: 5,
              min: 1,
              max: 60,
            },
          ],
        },
      ],
    };
  }

  if (modName.includes('wiki')) {
    return {
      sections: [
        {
          id: 'general',
          title: '常规设置',
          fields: [
            {
              key: 'max_pages_per_agent',
              type: 'number',
              label: '每个代理最大页面数',
              description: '每个代理可以创建的最大页面数量',
              default: 100,
              min: 1,
              max: 10000,
            },
            {
              key: 'max_page_content_length',
              type: 'number',
              label: '最大页面内容长度',
              description: '单个页面的最大内容长度（字符数）',
              default: 50000,
              min: 1000,
              max: 1000000,
            },
            {
              key: 'max_page_title_length',
              type: 'number',
              label: '最大页面标题长度',
              description: '页面标题的最大长度',
              default: 200,
              min: 1,
              max: 1000,
            },
          ],
        },
      ],
    };
  }

  if (modName.includes('project')) {
    return {
      sections: [
        {
          id: 'general',
          title: '常规设置',
          fields: [
            {
              key: 'max_concurrent_projects',
              type: 'number',
              label: '最大并发项目数',
              description: '同时运行的最大项目数量',
              default: 10,
              min: 1,
              max: 100,
            },
            {
              key: 'auto_invite_service_agents',
              type: 'boolean',
              label: '自动邀请服务代理',
              description: '自动将服务代理添加到新项目',
              default: true,
            },
            {
              key: 'project_timeout_hours',
              type: 'number',
              label: '项目超时时间 (小时)',
              description: '项目自动超时的时间',
              default: 24,
              min: 1,
              max: 720,
            },
            {
              key: 'enable_project_persistence',
              type: 'boolean',
              label: '启用项目持久化',
              description: '是否持久化项目状态',
              default: true,
            },
          ],
        },
      ],
    };
  }

  return null;
};

interface ModSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modName: string;
  modConfig?: Record<string, any>;
  onSave?: () => void;
}

const ModSettingsDialog: React.FC<ModSettingsDialogProps> = ({
  open,
  onOpenChange,
  modName,
  modConfig = {},
  onSave,
}) => {
  const { t } = useTranslation('admin');
  const { connector } = useOpenAgents();
  const { agentName, selectedNetwork } = useAuthStore();

  // Extract mod display name
  const modDisplayName = modName.split('.').pop() || modName;
  
  // State for form values
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [configSchema, setConfigSchema] = useState<ConfigSchema | null>(null);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setFormData({});
      setConfigSchema(null);
      setErrors({});
    }
  }, [open]);

  // Load config schema from mod manifest
  useEffect(() => {
    if (!open) return;

    const loadConfigSchema = async () => {
      setIsLoadingSchema(true);
      
      // First, try to get schema from backend
      if (connector) {
        try {
          const response = await connector.sendEvent({
            event_name: 'system.get_mod_manifest',
            source_id: agentName || 'system',
            destination_id: 'system:system',
            payload: {
              mod_name: modName,
            },
          });

          if (response.success && response.data?.manifest) {
            const manifest = response.data.manifest;
            if (manifest.config_schema) {
              setConfigSchema(manifest.config_schema);
              
              // Merge default values from schema with current config
              const mergedConfig = { ...manifest.default_config, ...modConfig };
              setFormData(mergedConfig);
              setIsLoadingSchema(false);
              return;
            } else if (manifest.default_config) {
              // If no schema but has default_config, use it
              const mergedConfig = { ...manifest.default_config, ...modConfig };
              setFormData(mergedConfig);
            }
          }
        } catch (error) {
          console.error('Failed to load config schema from backend:', error);
        }
      }

      // Fallback: Use mock schema for testing
      const mockSchema = getMockSchema(modName);
      if (mockSchema) {
        setConfigSchema(mockSchema);
        
        // Initialize form data with defaults from schema
        const defaultValues: Record<string, any> = {};
        mockSchema.sections.forEach((section) => {
          section.fields.forEach((field) => {
            if (field.default !== undefined) {
              defaultValues[field.key] = field.default;
            }
          });
        });
        
        // Merge with current config
        const mergedConfig = { ...defaultValues, ...modConfig };
        setFormData(mergedConfig);
      }
      
      setIsLoadingSchema(false);
    };

    loadConfigSchema();
  }, [open, modName, modConfig, connector, agentName]);

  // Handle field value change
  const handleFieldChange = (fieldPath: string, value: any) => {
    setFormData((prev) => {
      const newData = JSON.parse(JSON.stringify(prev)); // Deep clone
      
      // Handle nested paths like "parent.child" or "items[0].field"
      const setNestedValue = (obj: any, path: string, val: any) => {
        const parts = path.split('.');
        let current = obj;
        
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
          
          if (arrayMatch) {
            const arrayKey = arrayMatch[1];
            const index = parseInt(arrayMatch[2]);
            if (!current[arrayKey]) current[arrayKey] = [];
            if (!current[arrayKey][index]) current[arrayKey][index] = {};
            current = current[arrayKey][index];
          } else {
            if (!current[part] || typeof current[part] !== 'object') {
              current[part] = {};
            }
            current = current[part];
          }
        }
        
        const lastPart = parts[parts.length - 1];
        const lastArrayMatch = lastPart.match(/^(.+)\[(\d+)\]$/);
        
        if (lastArrayMatch) {
          const arrayKey = lastArrayMatch[1];
          const index = parseInt(lastArrayMatch[2]);
          if (!current[arrayKey]) current[arrayKey] = [];
          current[arrayKey][index] = val;
        } else {
          current[lastPart] = val;
        }
      };
      
      setNestedValue(newData, fieldPath, value);
      return newData;
    });
    
    // Clear error for this field
    if (errors[fieldPath]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[fieldPath];
        return newErrors;
      });
    }
  };

  // Validate form data
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (!configSchema) return true;

    const validateField = (field: any, value: any, path: string) => {
      if (field.required && (value === undefined || value === null || value === '')) {
        newErrors[path] = `${field.label} 是必填项`;
        return false;
      }

      if (field.type === 'number') {
        if (value !== undefined && value !== null) {
          if (field.min !== undefined && value < field.min) {
            newErrors[path] = `值不能小于 ${field.min}`;
            return false;
          }
          if (field.max !== undefined && value > field.max) {
            newErrors[path] = `值不能大于 ${field.max}`;
            return false;
          }
        }
      }

      if (field.type === 'string' && value) {
        if (field.maxLength && value.length > field.maxLength) {
          newErrors[path] = `长度不能超过 ${field.maxLength} 个字符`;
          return false;
        }
        if (field.pattern) {
          const regex = new RegExp(field.pattern);
          if (!regex.test(value)) {
            newErrors[path] = '格式不正确';
            return false;
          }
        }
      }

      // Validate nested fields
      if (field.type === 'object' && field.fields) {
        const objValue = typeof value === 'object' && value !== null ? value : {};
        field.fields.forEach((subField: any) => {
          validateField(subField, objValue[subField.key], `${path}.${subField.key}`);
        });
      }

      return true;
    };

    configSchema.sections.forEach((section) => {
      section.fields.forEach((field) => {
        const value = formData[field.key];
        validateField(field, value, field.key);
      });
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle save
  const handleSave = async () => {
    if (!connector || !selectedNetwork) {
      toast.error(t('modManagement.settings.notConnected'));
      return;
    }

    // Validate form
    if (!validateForm()) {
      toast.error(t('modManagement.settings.validationFailed', '请检查表单错误'));
      return;
    }

    setIsSaving(true);
    try {
      // Update mod config via system event
      const response = await connector.sendEvent({
        event_name: 'system.mod.update_config',
        source_id: agentName || 'system',
        destination_id: 'system:system',
        payload: {
          mod_path: modName,
          config: formData,
        },
      });

      if (response.success) {
        const saveResponse = response.data as SaveConfigResponse;
        toast.success(saveResponse.message || t('modManagement.settings.saveSuccess'));
        onSave?.();
        // Show restart dialog will be handled by parent if requiresRestart is true
        onOpenChange(false);
      } else {
        // Handle validation errors from backend
        if (response.data?.errors) {
          setErrors(response.data.errors);
          toast.error(response.message || t('modManagement.settings.saveFailed'));
        } else {
          toast.error(response.message || t('modManagement.settings.saveFailed'));
        }
      }
    } catch (error: any) {
      console.error('Failed to save mod config:', error);
      toast.error(t('modManagement.settings.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  // Render config fields based on schema
  const renderConfigFields = () => {
    // If schema is available, use schema-driven rendering
    if (configSchema && configSchema.sections) {
      return (
        <div className="space-y-6">
          {configSchema.sections.map((section) => (
            <div key={section.id}>
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">
                {section.title}
              </h3>
              <div className="space-y-4">
                {section.fields.map((field) => (
                  <ConfigFieldRenderer
                    key={field.key}
                    field={field}
                    value={formData[field.key]}
                    onChange={(value) => handleFieldChange(field.key, value)}
                    errors={errors}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    // Fallback: Show JSON editor if no schema
    if (isLoadingSchema) {
      return (
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('modManagement.settings.loadingSchema', '加载配置模式...')}
            </p>
          </div>
        </div>
      );
    }

    // No schema available - show empty state
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="text-center max-w-md">
          <div className="mb-4">
            <svg
              className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            {t('modManagement.settings.noSchema.title', '暂无配置模式')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('modManagement.settings.noSchema.description', '此 Mod 尚未定义配置模式。配置模式将在 Mod 的 manifest.json 文件中定义。')}
          </p>
        </div>
      </div>
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="w-full max-w-2xl max-h-[90vh] mx-4 flex flex-col rounded-lg bg-white dark:bg-gray-800">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              {t('modManagement.settings.title', '{{modName}} 设置', { modName: modDisplayName })}
            </h3>
            <button
              onClick={() => onOpenChange(false)}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 px-6 py-4 overflow-y-auto min-h-0">
          {renderConfigFields()}
        </div>

        {/* Bottom buttons */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3 flex-shrink-0">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            className="px-4 py-2 rounded-lg transition-colors text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('modManagement.settings.cancel', '取消')}
          </button>
          {configSchema && (
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving 
                ? t('modManagement.settings.saving', '保存中...')
                : t('modManagement.settings.save', '保存设置')
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModSettingsDialog;

