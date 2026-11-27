import { useEffect, useRef, useState } from 'react';
import type { Model, System } from '../shared/types';
import { useInterfaceLanguage } from './interface-language';
import { chatFontSizes, codeFontSizes, defaultTextSize } from './font-sizes';
import {
  defaultBrowserPreferences,
  type NotificationPreferences,
  type Preferences,
} from './browser-preferences';
import { NativeConfigurationSettings, executionForm } from './NativeConfigurationSettings';
import { InteractionDialog } from './InteractionDialog';
import { NetworkSettings, networkForm } from './NetworkSettings';
import { RuntimeSettings, runtimeForm } from './RuntimeSettings';
import { UsageSettings } from './UsageSettings';
import { GlobalInstructionsSettings, instructionsForm } from './GlobalInstructionsSettings';
import { Icon, IconButton } from './primitives';
import { NotificationSettings } from './NotificationSettings';
import { MaintenanceSettings } from './MaintenanceSettings';
import { WorkspaceSettings, loginValidityForm } from './WorkspaceSettings';
import { DiagnosticsSettings } from './DiagnosticsSettings';
import { BackupRestoreSettings } from './BackupRestoreSettings';
import { AccessTokenSettings } from './AccessTokenSettings';
import { emptyFormDraft } from './settings-form';
import { KeyboardSettings } from './KeyboardSettings';
import { BrowserPreferencesTransfer } from './BrowserPreferencesTransfer';
import type { BrowserPreferencesFile } from './browser-preferences-file';
import type { SidebarWidths } from './SidebarResize';

const settingsSections = [
  {
    id: 'preferences',
    scope: 'browser',
    label: 'General',
    icon: 'settings',
    keywords:
      'preferences appearance theme language font text size interaction keyboard shortcut review queue scroll files hidden sidebar layout width directory reset defaults 偏好 外观 主题 语言 字号 字体 交互 键盘 快捷键 复查 排队 滚动 文件 隐藏 侧栏 布局 宽度 目录 重置 默认',
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
    scope: 'codex',
    label: 'Execution',
    icon: 'newchat',
    keywords:
      'codex configuration model reasoning permissions fast plan default 配置 默认 模型 推理 权限 计划',
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
    scope: 'codex',
    label: 'Codex settings',
    icon: 'terminal',
    keywords:
      'runtime cli codex request timeout usage billing quota limits credits reset token 运行环境 运行时 请求 超时 用量 计费 套餐 额度 限额 重置 点数',
  },
  {
    id: 'maintenance',
    scope: 'server',
    label: 'Maintenance',
    icon: 'activity',
    keywords:
      'status task cli version diagnostics connection logs runtime paths executable launcher data directory 维护 状态 任务 版本 诊断 连接 日志 运行路径 启动入口 可执行文件 数据目录',
  },
  {
    id: 'backup',
    scope: 'data',
    label: 'Backup & restore',
    icon: 'archive',
    keywords:
      'snapshot database sqlite import export recovery browser preferences file network configuration json 备份 快照 数据库 恢复 还原 导入 导出 浏览器偏好 网络配置 配置文件',
  },
  {
    id: 'instructions',
    scope: 'codex',
    label: 'Instructions',
    icon: 'file',
    keywords: 'AGENTS.md Codex global instructions rules 全局 指令 规则',
  },
] as const;
type SettingsSection = (typeof settingsSections)[number]['id'];
const settingsScopes = [
  { id: 'browser', label: 'Preferences' },
  { id: 'codex', label: 'Codex' },
  { id: 'server', label: 'Server' },
  { id: 'data', label: 'Data' },
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
        className="settings-action"
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
  initialSection = 'preferences',
  usageRevision,
  value,
  sidebarWidths,
  restoreSidebarWidths,
  importBrowserPreferences,
  change,
  changeNotifications,
  close,
  saveError,
  configurationProject,
  models,
  autoReviewReady,
  configurationChanged,
  system,
  maintenanceBusy,
  changeMaintenance,
  signInAfterTokenChange,
}: {
  initialSection?: SettingsSection;
  usageRevision: number;
  value: Preferences;
  sidebarWidths: SidebarWidths;
  restoreSidebarWidths: () => boolean;
  importBrowserPreferences: (file: BrowserPreferencesFile) => boolean;
  change: (value: Preferences) => void;
  changeNotifications: (patch: Partial<NotificationPreferences>) => void;
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
  models: Model[];
  autoReviewReady: boolean;
  configurationChanged: () => void;
}) {
  const { t } = useInterfaceLanguage();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [sidebarWidthStatus, setSidebarWidthStatus] = useState<'saved' | 'error'>();
  const [networkTransferTarget, setNetworkTransferTarget] = useState<HTMLElement | null>(null);
  const [visited, setVisited] = useState({
    preferences: true,
    defaults: false,
    network: false,
    runtime: false,
    instructions: false,
    notifications: false,
    maintenance: false,
    backup: false,
    [initialSection]: true,
  });
  const [configurationDraft, setConfigurationDraft] = useState(emptyFormDraft);
  const [networkDraft, setNetworkDraft] = useState(emptyFormDraft);
  const [runtimeDraft, setRuntimeDraft] = useState(emptyFormDraft);
  const [instructionsDraft, setInstructionsDraft] = useState(emptyFormDraft);
  const [loginDraft, setLoginDraft] = useState(emptyFormDraft);
  const [tokenDraft, setTokenDraft] = useState({ changed: false, busy: false });
  const otherDrafts = [
    configurationDraft,
    networkDraft,
    runtimeDraft,
    instructionsDraft,
    loginDraft,
  ];
  const drafts = [...otherDrafts, tokenDraft];
  const sectionHasDraft: Partial<Record<SettingsSection, boolean>> = {
    defaults: configurationDraft.changed,
    network: networkDraft.changed || loginDraft.changed || tokenDraft.changed,
    runtime: runtimeDraft.changed,
    instructions: instructionsDraft.changed,
  };
  const dirtySections = settingsSections.filter(({ id }) => sectionHasDraft[id]);
  const currentForms = [
    {
      section: 'defaults',
      id: executionForm,
      draft: configurationDraft,
      label: 'Save execution settings',
      saved: 'Saved',
    },
    {
      section: 'instructions',
      id: instructionsForm,
      draft: instructionsDraft,
      label: 'Save global instructions',
      saved: 'Global instructions saved.',
    },
    {
      section: 'runtime',
      id: runtimeForm,
      draft: runtimeDraft,
      label: 'Save runtime settings',
      saved: 'Runtime settings saved.',
    },
    {
      section: 'network',
      id: networkForm,
      draft: networkDraft,
      label: 'Save network settings',
      shortLabel: 'Save network',
      saved: 'Network settings saved.',
    },
    {
      section: 'network',
      id: loginValidityForm,
      draft: loginDraft,
      label: 'Save login validity',
      shortLabel: 'Save sign-in',
      saved: 'Workspace settings saved.',
    },
  ].filter((form) => form.section === section);
  const formsToSave = currentForms.filter(({ draft }) => draft.changed);
  const savedForms = currentForms.filter(({ draft }) => draft.saved && !draft.changed);
  const restartRequired = otherDrafts.some((draft) => draft.restartRequired);
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
  }, [discarding, section]);
  const requestClose = () => {
    if (discarding) {
      stay();
    } else if (dirtySections.length) {
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
        <details className="preferences-help preferences-type-preview">
          <summary>{t('Text preview')}</summary>
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
        </details>
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
            <option value="steer">{t('Add to running task')}</option>
            <option value="queue">{t('Queue for next turn')}</option>
          </select>
        </label>
        <label className="preference-row">
          <span className="preference-description">{t('New conversation directory')}</span>
          <select
            value={value.newConversationDirectory}
            onChange={(event) =>
              change({
                ...value,
                newConversationDirectory: event.target.value === 'choose' ? 'choose' : 'current',
              })
            }
          >
            <option value="current">{t('Use Codex startup directory')}</option>
            <option value="choose">{t('Choose each time')}</option>
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
      </section>
      <KeyboardSettings value={value} change={change} />
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
      <section className="preferences-section" aria-labelledby="preferences-layout">
        <h3 id="preferences-layout">{t('Layout')}</h3>
        <div className="preference-row">
          <span>{t('Sidebar widths')}</span>
          <button
            className="settings-action"
            type="button"
            onClick={() => setSidebarWidthStatus(restoreSidebarWidths() ? 'saved' : 'error')}
          >
            {t('Restore default sidebar widths')}
          </button>
        </div>
        {sidebarWidthStatus === 'saved' && (
          <p role="status">{t('Default sidebar widths restored.')}</p>
        )}
        {sidebarWidthStatus === 'error' && (
          <p role="alert">{t('Could not save sidebar widths in this browser.')}</p>
        )}
      </section>
      <section className="preferences-section" aria-labelledby="preferences-defaults">
        <h3 id="preferences-defaults">{t('Defaults')}</h3>
        <ResetSettings
          label={t('Reset browser settings')}
          detail={t(
            'Restore appearance, interaction, file visibility, and notification preferences in this browser.',
          )}
          reset={() => change(defaultBrowserPreferences)}
        />
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
      <div
        className="preferences-page"
        hidden={discarding}
        onKeyDown={(event) => {
          if (
            currentForms.length &&
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 's' &&
            !event.nativeEvent.isComposing
          ) {
            const focusedForm = (event.target as HTMLElement).closest('form');
            if (focusedForm && !currentForms.some(({ id }) => id === focusedForm.id)) return;
            event.preventDefault();
            const form = focusedForm
              ? formsToSave.find(({ id }) => id === focusedForm.id)
              : formsToSave.length === 1
                ? formsToSave[0]
                : undefined;
            if (form)
              event.currentTarget
                .querySelector<HTMLButtonElement>(`button[form="${form.id}"]`)
                ?.click();
          }
        }}
      >
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
                    <div
                      className="settings-nav-group"
                      key={scope}
                      role="group"
                      aria-label={t(scopeLabel)}
                    >
                      <span className="settings-scope-label" aria-hidden="true">
                        {t(scopeLabel)}
                      </span>
                      {sections.map(({ id, label, icon }) => (
                        <button
                          key={id}
                          type="button"
                          ref={section === id ? sectionButton : undefined}
                          aria-pressed={section === id}
                          aria-controls="settings-detail"
                          aria-description={sectionHasDraft[id] ? t('Unsaved changes') : undefined}
                          onClick={() => selectSection(id)}
                        >
                          <Icon name={icon} size={16} />
                          {t(label)}
                          {sectionHasDraft[id] && (
                            <span className="settings-draft-dot" aria-hidden="true" />
                          )}
                        </button>
                      ))}
                    </div>
                  )
                );
              })}
              {!matches.length && <p role="status">{t('No matching settings.')}</p>}
            </div>
          </div>
          <div
            className="settings-panels"
            id="settings-detail"
            role="group"
            aria-labelledby="settings-detail-title"
          >
            <h2 className="settings-detail-title" id="settings-detail-title">
              {t(currentCategory.label)}
            </h2>
            <div className="preferences-page" hidden={section !== 'preferences'}>
              {preferences}
            </div>
            {visited.defaults && (
              <div className="preferences-content" hidden={section !== 'defaults'}>
                <NativeConfigurationSettings
                  key={configurationProject}
                  projectId={configurationProject}
                  models={models}
                  autoReviewReady={autoReviewReady}
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
                <DiagnosticsSettings version={system?.version} />
              </div>
            )}
            {visited.backup && (
              <div className="preferences-content" hidden={section !== 'backup'}>
                <BackupRestoreSettings />
                <section
                  className="preferences-section"
                  aria-labelledby="settings-network-transfer"
                  ref={setNetworkTransferTarget}
                >
                  <h3 id="settings-network-transfer">{t('Network configuration')}</h3>
                </section>
                <BrowserPreferencesTransfer
                  value={value}
                  widths={sidebarWidths}
                  apply={(file) => {
                    if (!importBrowserPreferences(file)) return false;
                    setSidebarWidthStatus(undefined);
                    return true;
                  }}
                />
              </div>
            )}
            {(visited.network || visited.backup) && (
              <div className="preferences-content settings-forms" hidden={section !== 'network'}>
                <NetworkSettings
                  onDraft={setNetworkDraft}
                  transferTarget={networkTransferTarget}
                  onImported={() => {
                    returnFocus.current = true;
                    selectSection('network');
                  }}
                />
                {visited.network && (
                  <>
                    <WorkspaceSettings onDraft={setLoginDraft} />
                    <AccessTokenSettings
                      onDraft={setTokenDraft}
                      otherSettingsPending={otherDrafts.some(
                        (draft) => draft.changed || draft.busy,
                      )}
                      onSignIn={signInAfterTokenChange}
                    />
                  </>
                )}
              </div>
            )}
            {visited.runtime && (
              <div className="preferences-content" hidden={section !== 'runtime'}>
                {section === 'runtime' && <UsageSettings key={usageRevision} />}
                <RuntimeSettings onDraft={setRuntimeDraft} />
              </div>
            )}
            {visited.instructions && (
              <div
                className="preferences-content instructions-settings"
                hidden={section !== 'instructions'}
              >
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
          {(!!dirtySections.length || !!savedForms.length || restartRequired) && (
            <div className="settings-footer-status" role="status">
              {!!dirtySections.length && <span>{t('Unsaved changes')}</span>}
              {savedForms.map(({ id, saved }) => (
                <span key={id}>{t(saved)}</span>
              ))}
              {restartRequired && (
                <span className="settings-restart-status">{t('Restart Codes to apply')}</span>
              )}
            </div>
          )}
          <div className="preferences-footer-actions">
            <button
              className="preferences-done"
              type="button"
              onClick={requestClose}
              disabled={discardBusy}
            >
              {t('Done')}
            </button>
            {formsToSave.map(({ id, draft, label, shortLabel }) => (
              <button
                key={id}
                className="primary preferences-done"
                type="submit"
                form={id}
                aria-label={t(label)}
                aria-keyshortcuts="Control+S Meta+S"
                aria-busy={draft.busy}
                disabled={discardBusy || !draft.canSave}
              >
                {t(formsToSave.length > 1 && shortLabel ? shortLabel : 'Save')}
              </button>
            ))}
          </div>
        </div>
      </div>
      {discarding && (
        <div
          className="preferences-content preferences-discard"
          role="group"
          aria-labelledby="discard-settings-heading"
        >
          <h3 id="discard-settings-heading">{t('Discard unsaved settings?')}</h3>
          <ul className="settings-unsaved-list">
            {dirtySections.map(({ id, label }) => (
              <li key={id}>
                <button
                  className="settings-action"
                  type="button"
                  onClick={() => {
                    selectSection(id);
                    stay();
                  }}
                >
                  {t(label)}
                </button>
              </li>
            ))}
          </ul>
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
