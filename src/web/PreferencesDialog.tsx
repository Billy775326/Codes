import { useEffect, useRef, useState } from 'react';
import type { System } from '../shared/types';
import { useInterfaceLanguage } from './interface-language';
import { chatFontSizes, codeFontSizes, defaultTextSize } from './font-sizes';
import {
  defaultBrowserPreferences,
  type NotificationPreferences,
  type Preferences,
} from './browser-preferences';
import { NativeConfigurationSettings } from './NativeConfigurationSettings';
import { InteractionDialog } from './InteractionDialog';
import { NetworkSettings } from './NetworkSettings';
import { RuntimeSettings } from './RuntimeSettings';
import { GlobalInstructionsSettings } from './GlobalInstructionsSettings';
import { Icon, IconButton } from './primitives';
import { NotificationSettings } from './NotificationSettings';
import { MaintenanceSettings } from './MaintenanceSettings';
import { WorkspaceSettings } from './WorkspaceSettings';
import { DiagnosticsSettings } from './DiagnosticsSettings';
import { BackupRestoreSettings } from './BackupRestoreSettings';
import { AccessTokenSettings } from './AccessTokenSettings';

const settingsSections = [
  {
    id: 'preferences',
    scope: 'browser',
    label: 'General',
    icon: 'settings',
    keywords:
      'preferences appearance theme language font text size interaction shortcut review queue scroll files hidden 偏好 外观 主题 语言 字号 字体 交互 快捷键 复查 排队 滚动 文件 隐藏',
  },
  {
    id: 'notifications',
    scope: 'browser',
    label: 'Notifications',
    icon: 'bell',
    keywords:
      'browser alerts desktop approval question completed failed stopped 通知 通知事件 浏览器 提醒 桌面 提问 审批 完成 失败 停止',
  },
  {
    id: 'defaults',
    scope: 'workspace',
    label: 'Codex configuration',
    icon: 'newchat',
    keywords:
      'new conversation chat model reasoning permissions fast plan default 默认 模型 推理 权限 计划',
  },
  {
    id: 'network',
    scope: 'server',
    label: 'Network & access',
    icon: 'link',
    keywords:
      'listen host port origin authentication cloudflare tailscale login session expiry lifetime access token 网络 访问 监听 端口 域名 认证 登录 有效期 令牌 访问令牌',
  },
  {
    id: 'runtime',
    scope: 'server',
    label: 'Codex CLI',
    icon: 'terminal',
    keywords: 'runtime cli codex questions timeout executable 运行环境 运行时 提问 超时 可执行文件',
  },
  {
    id: 'maintenance',
    scope: 'server',
    label: 'Maintenance',
    icon: 'activity',
    keywords: 'status task version diagnostics connection logs 维护 状态 任务 版本 诊断 连接 日志',
  },
  {
    id: 'backup',
    scope: 'server',
    label: 'Backup & restore',
    icon: 'archive',
    keywords: 'snapshot database sqlite export recovery 备份 快照 数据库 恢复 还原',
  },
  {
    id: 'instructions',
    scope: 'workspace',
    label: 'Projects',
    icon: 'folder',
    keywords:
      'project default directory path AGENTS.md Codex global instructions rules 项目 目录 路径 默认 全局 指令 规则',
  },
] as const;
type SettingsSection = (typeof settingsSections)[number]['id'];
const settingsScopes = [
  { id: 'browser', label: 'Browser' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'server', label: 'Server' },
] as const;

function ResetSettings({
  label,
  detail,
  reset,
  disabled,
}: {
  label: string;
  detail: string;
  reset: () => void;
  disabled?: boolean;
}) {
  const { t } = useInterfaceLanguage();
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dismiss = () => {
    setConfirming(false);
    trigger.current?.focus();
  };
  return (
    <div className="preferences-reset">
      <button
        ref={trigger}
        type="button"
        aria-expanded={confirming}
        disabled={disabled}
        onClick={() => setConfirming(!confirming)}
      >
        {label}
      </button>
      {confirming && (
        <div role="group" aria-label={t('{label} confirmation', { label })}>
          <p>{detail}</p>
          <div className="preferences-reset-actions">
            <button type="button" onClick={dismiss} autoFocus>
              {t('Cancel')}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                reset();
                dismiss();
              }}
            >
              {t('Confirm reset')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export function PreferencesDialog({
  value,
  change,
  changeNotifications,
  close,
  saveError,
  configurationProject,
  openConfigurationFirst,
  configurationChanged,
  system,
  maintenanceBusy,
  changeMaintenance,
  refreshSystem,
  signInAfterTokenChange,
}: {
  value: Preferences;
  change: (value: Preferences) => void;
  changeNotifications: (patch: Partial<NotificationPreferences>) => void;
  refreshSystem: () => void;
  signInAfterTokenChange: (message: string) => void;
  close: () => void;
  saveError?: string;
  system?: System;
  maintenanceBusy: boolean;
  changeMaintenance: (
    action: 'start' | 'cancel',
    onError: (error: unknown) => void,
  ) => Promise<void>;
  configurationProject?: string;
  openConfigurationFirst?: boolean;
  configurationChanged: () => void;
}) {
  const { t } = useInterfaceLanguage();
  const [section, setSection] = useState<SettingsSection>(
    openConfigurationFirst ? 'defaults' : 'preferences',
  );
  const [visited, setVisited] = useState({
    preferences: true,
    defaults: !!openConfigurationFirst,
    network: false,
    runtime: false,
    instructions: false,
    notifications: false,
    maintenance: false,
    backup: false,
  });
  const [configurationDraft, setConfigurationDraft] = useState({ changed: false, busy: false });
  const [networkDraft, setNetworkDraft] = useState({ changed: false, busy: false });
  const [runtimeDraft, setRuntimeDraft] = useState({ changed: false, busy: false });
  const [instructionsDraft, setInstructionsDraft] = useState({ changed: false, busy: false });
  const [projectDefaultDraft, setProjectDefaultDraft] = useState({ changed: false, busy: false });
  const [loginDraft, setLoginDraft] = useState({ changed: false, busy: false });
  const [tokenDraft, setTokenDraft] = useState({ changed: false, busy: false });
  const otherDrafts = [
    configurationDraft,
    networkDraft,
    runtimeDraft,
    instructionsDraft,
    projectDefaultDraft,
    loginDraft,
  ];
  const drafts = [...otherDrafts, tokenDraft];
  const [discarding, setDiscarding] = useState(false);
  const sectionButton = useRef<HTMLButtonElement>(null);
  const categoryButton = useRef<HTMLButtonElement>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const currentCategory = settingsSections.find(({ id }) => id === section)!;
  const searchInput = useRef<HTMLInputElement>(null);
  const discardBusy = drafts.some((draft) => draft.busy);
  const selectSection = (value: SettingsSection) => {
    setVisited((previous) => (previous[value] ? previous : { ...previous, [value]: true }));
    setSection(value);
    setQuery('');
    setCategoriesOpen(false);
    if (categoryButton.current?.checkVisibility()) categoryButton.current.focus();
  };
  const returnFocus = useRef(false);
  const [query, setQuery] = useState('');
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = settingsSections.filter(({ label, keywords }) => {
    const text = `${label} ${t(label)} ${keywords}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const stay = () => {
    returnFocus.current = true;
    setDiscarding(false);
  };
  useEffect(() => {
    if (!discarding && returnFocus.current) {
      returnFocus.current = false;
      const selected = sectionButton.current;
      (selected?.checkVisibility()
        ? selected
        : categoryButton.current?.checkVisibility()
          ? categoryButton.current
          : searchInput.current
      )?.focus();
    }
  }, [discarding]);
  const requestClose = () => {
    if (discarding) {
      stay();
    } else if (drafts.some((draft) => draft.changed)) {
      setDiscarding(true);
    } else {
      close();
    }
  };
  const preferences = (
    <div className="preferences-content">
      <section className="preferences-section" aria-labelledby="preferences-appearance">
        <h3 id="preferences-appearance">{t('Appearance')}</h3>
        <label className="preference-row">
          <span className="preference-description">{t('Language')}</span>
          <select
            value={value.language}
            onChange={(event) =>
              change({ ...value, language: event.target.value === 'zh-CN' ? 'zh-CN' : 'en' })
            }
          >
            <option value="en" lang="en">
              English
            </option>
            <option value="zh-CN" lang="zh-CN">
              简体中文
            </option>
          </select>
        </label>
        <label className="preference-row">
          <span className="preference-description">{t('Theme')}</span>
          <select
            aria-label={t('Theme')}
            value={value.theme}
            onChange={(event) =>
              change({ ...value, theme: event.target.value as Preferences['theme'] })
            }
          >
            <option value="dark">{t('Dark')}</option>
            <option value="light">{t('Light')}</option>
            <option value="system">{t('System')}</option>
          </select>
        </label>
        <label className="preference-row">
          <span>{t('Chat text size')}</span>
          <select
            aria-label={t('Chat text size')}
            value={value.chatFontSize ?? ''}
            onChange={(event) =>
              change({
                ...value,
                chatFontSize: event.target.value ? Number(event.target.value) : undefined,
              })
            }
          >
            <option value="">{t('Default ({size} px)', { size: defaultTextSize })}</option>
            {chatFontSizes.map((size) => (
              <option key={size} value={size}>
                {size} px
              </option>
            ))}
          </select>
        </label>
        <label className="preference-row">
          <span>{t('Code text size')}</span>
          <select
            aria-label={t('Code text size')}
            value={value.codeFontSize ?? ''}
            onChange={(event) =>
              change({
                ...value,
                codeFontSize: event.target.value ? Number(event.target.value) : undefined,
              })
            }
          >
            <option value="">{t('Default ({size} px)', { size: defaultTextSize })}</option>
            {codeFontSizes.map((size) => (
              <option key={size} value={size}>
                {size} px
              </option>
            ))}
          </select>
        </label>
        <div className="preferences-preview" role="region" aria-label={t('Text preview')}>
          <div className="prose">
            <p>
              {t('Aa Bb Cc · 0123456789')}
              <br />
              中文字体预览。
            </p>
            <pre>
              <code>const message = "Hello, Codex";</code>
            </pre>
          </div>
        </div>
      </section>
      <section className="preferences-section" aria-labelledby="preferences-files">
        <h3 id="preferences-files">{t('Files')}</h3>
        <label className="preference-row">
          <span>{t('Show hidden files')}</span>
          <input
            className="preference-checkbox"
            type="checkbox"
            role="switch"
            checked={value.showHiddenFiles}
            onChange={(event) => change({ ...value, showHiddenFiles: event.target.checked })}
          />
        </label>
      </section>
      <section className="preferences-section" aria-labelledby="preferences-interaction">
        <h3 id="preferences-interaction">{t('Interaction')}</h3>
        <label className="preference-row">
          <span className="preference-description">{t('Follow-up delivery')}</span>
          <select
            aria-label={t('Follow-up delivery')}
            value={value.followUp}
            onChange={(event) =>
              change({ ...value, followUp: event.target.value as Preferences['followUp'] })
            }
          >
            <option value="queue">{t('Queue for next turn')}</option>
            <option value="steer">{t('Add to running task')}</option>
          </select>
        </label>
        <label className="preference-row">
          <span className="preference-description">{t('Send shortcut')}</span>
          <select
            aria-label={t('Send shortcut')}
            value={value.enter}
            onChange={(event) =>
              change({ ...value, enter: event.target.value as Preferences['enter'] })
            }
          >
            <option value="enter">{t('Enter')}</option>
            <option value="cmdIfMultiline">{t('Multiline: Ctrl/Cmd+Enter')}</option>
            <option value="cmdAlways">Ctrl/Cmd+Enter</option>
          </select>
        </label>
        <label className="preference-row">
          <span className="preference-description">{t('Review location')}</span>
          <select
            aria-label={t('Review location')}
            value={value.review}
            onChange={(event) =>
              change({ ...value, review: event.target.value as Preferences['review'] })
            }
          >
            <option value="inline">{t('Current conversation')}</option>
            <option value="detached">{t('Separate conversation')}</option>
          </select>
        </label>
        <label className="preference-row">
          <span>{t('Scroll with replies')}</span>
          <input
            className="preference-checkbox"
            type="checkbox"
            role="switch"
            checked={value.autoScroll}
            onChange={(event) => change({ ...value, autoScroll: event.target.checked })}
          />
        </label>
        <details className="preferences-help">
          <summary>{t('Editing and shortcuts')}</summary>
          <p>{t('Use Up and Down to recall sent messages in the current conversation.')}</p>
          <p>
            {t(
              'Shift+Enter adds a line. On phones, Enter adds a line. Ctrl/Cmd+Shift+Enter switches delivery for one follow-up.',
            )}
          </p>
          <p>
            {t(
              'Queued messages can be edited until dispatch. Immediate additions use the running task’s settings.',
            )}
          </p>
        </details>
      </section>
    </div>
  );
  return (
    <InteractionDialog
      title={t('Settings')}
      close={requestClose}
      busy={discardBusy}
      className="preferences-dialog"
    >
      <div className="preferences-page" hidden={discarding}>
        <div className="settings-layout">
          <div
            className="settings-navigation"
            data-show-categories={categoriesOpen || !!terms.length}
          >
            <button
              className="settings-category-toggle settings-action"
              ref={categoryButton}
              type="button"
              aria-label={t('Settings categories')}
              aria-expanded={categoriesOpen || !!terms.length}
              aria-controls="settings-categories"
              aria-describedby="settings-selected-category"
              onClick={() => {
                if (terms.length) setQuery('');
                setCategoriesOpen(!(categoriesOpen || terms.length));
              }}
            >
              <Icon name={currentCategory.icon} size={16} />
              <span id="settings-selected-category">{t(currentCategory.label)}</span>
              <Icon name="chevron" size={14} />
            </button>
            <form
              className="settings-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                if (terms.length && matches[0]) selectSection(matches[0].id);
              }}
            >
              <Icon name="search" size={16} />
              <input
                ref={searchInput}
                type="search"
                aria-label={t('Search settings')}
                placeholder={t('Search settings')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <IconButton
                  icon="close"
                  label={t('Clear settings search')}
                  onClick={() => {
                    searchInput.current?.focus();
                    setQuery('');
                  }}
                />
              )}
            </form>
            <div
              className="preferences-nav"
              id="settings-categories"
              role="group"
              aria-label={t('Settings sections')}
            >
              {settingsScopes.map(({ id: scope, label: scopeLabel }) => {
                const sections = matches.filter((item) => item.scope === scope);
                return (
                  sections.length > 0 && (
                    <div className="settings-nav-group" key={scope}>
                      <span className="settings-nav-label">{t(scopeLabel)}</span>
                      {sections.map(({ id, label, icon }) => (
                        <button
                          key={id}
                          type="button"
                          ref={section === id ? sectionButton : undefined}
                          aria-pressed={section === id}
                          onClick={() => selectSection(id)}
                        >
                          <Icon name={icon} size={16} />
                          {t(label)}
                        </button>
                      ))}
                    </div>
                  )
                );
              })}
              {!matches.length && <p role="status">{t('No matching settings.')}</p>}
            </div>
          </div>
          <div className="settings-panels">
            <div className="preferences-page" hidden={section !== 'preferences'}>
              {preferences}
            </div>
            {visited.defaults && (
              <div className="preferences-content" hidden={section !== 'defaults'}>
                <NativeConfigurationSettings
                  key={configurationProject}
                  projectId={configurationProject}
                  changed={configurationChanged}
                  onDraft={setConfigurationDraft}
                />
              </div>
            )}
            {visited.notifications && (
              <div className="preferences-content" hidden={section !== 'notifications'}>
                <NotificationSettings value={value} change={changeNotifications} />
              </div>
            )}
            {visited.maintenance && (
              <div className="preferences-content" hidden={section !== 'maintenance'}>
                <MaintenanceSettings
                  system={system}
                  maintenanceBusy={maintenanceBusy}
                  changeMaintenance={changeMaintenance}
                />
                <DiagnosticsSettings />
              </div>
            )}
            {visited.backup && (
              <div className="preferences-content" hidden={section !== 'backup'}>
                <BackupRestoreSettings />
              </div>
            )}
            {visited.network && (
              <div className="preferences-content settings-forms" hidden={section !== 'network'}>
                <NetworkSettings onDraft={setNetworkDraft} />
                <WorkspaceSettings field="sessionHours" onDraft={setLoginDraft} />
                <AccessTokenSettings
                  onDraft={setTokenDraft}
                  otherSettingsPending={otherDrafts.some((draft) => draft.changed || draft.busy)}
                  onSignIn={signInAfterTokenChange}
                />
              </div>
            )}
            {visited.runtime && (
              <div className="preferences-page" hidden={section !== 'runtime'}>
                <RuntimeSettings onDraft={setRuntimeDraft} />
              </div>
            )}
            {visited.instructions && (
              <div
                className="preferences-content settings-forms"
                hidden={section !== 'instructions'}
              >
                <WorkspaceSettings
                  field="defaultProjectDirectory"
                  fallbackDirectory={system?.projectDirectoryFallback}
                  activeDirectory={system?.defaultProjectPath}
                  onDraft={setProjectDefaultDraft}
                  onSaved={refreshSystem}
                />
                <GlobalInstructionsSettings onDraft={setInstructionsDraft} />
              </div>
            )}
          </div>
        </div>
        <div className="preferences-footer">
          {saveError && (
            <div className="preferences-save-error">
              <span role="alert">{t(saveError)}</span>
              <button type="button" onClick={() => change(value)}>
                {t('Retry save')}
              </button>
            </div>
          )}
          {section === 'preferences' && (
            <ResetSettings
              label={t('Reset browser settings')}
              detail={t(
                'Restore appearance, interaction, file visibility, and notification preferences in this browser.',
              )}
              reset={() => change(defaultBrowserPreferences)}
            />
          )}
          <button
            className="preferences-done"
            type="button"
            onClick={requestClose}
            disabled={discardBusy}
          >
            {t('Done')}
          </button>
        </div>
      </div>
      {discarding && (
        <div
          className="preferences-content preferences-discard"
          role="group"
          aria-labelledby="discard-settings-heading"
        >
          <h3 id="discard-settings-heading">{t('Discard unsaved settings?')}</h3>
          <p>{t('Unsaved edits will be lost.')}</p>
          <div className="network-actions">
            <button type="button" autoFocus onClick={stay}>
              {t('Keep editing')}
            </button>
            <button type="button" onClick={close}>
              {t('Discard changes')}
            </button>
          </div>
        </div>
      )}
    </InteractionDialog>
  );
}
