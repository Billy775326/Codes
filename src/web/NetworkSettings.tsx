import { useInterfaceLanguage } from './interface-language';
import { useEffect, useRef, useState } from 'react';
import {
  loopbackHosts,
  networkSettingsTransferSchema,
  type NetworkSettingsSnapshot,
  type NetworkSettings,
} from '../shared/network-settings';
import { ApiError, message, request } from './api';
import { IconButton } from './primitives';

const path = '/settings/network';

function allowedAddresses(settings: NetworkSettingsSnapshot['settings'], port: string) {
  return settings.origins
    .map((address) => {
      const url = new URL(address);
      const local = loopbackHosts.some((host) => url.hostname === host) || url.hostname === '[::1]';
      if (
        local &&
        url.protocol === 'http:' &&
        Number(url.port || 80) === settings.port &&
        Number(port) >= 1 &&
        Number(port) <= 65535
      ) {
        url.port = port;
        return url.origin;
      }
      return address;
    })
    .join('\n');
}

export function NetworkSettings({
  onDraft,
}: {
  onDraft: (value: { changed: boolean; busy: boolean }) => void;
}) {
  const { t } = useInterfaceLanguage();
  const [snapshot, setSnapshot] = useState<NetworkSettingsSnapshot>();
  const [host, setHost] = useState<(typeof loopbackHosts)[number]>('127.0.0.1');
  const [port, setPort] = useState('');
  const [origins, setOrigins] = useState<string>();
  const [authMode, setAuthMode] = useState<NetworkSettings['authMode']>('local');
  const [issuer, setIssuer] = useState('');
  const [audience, setAudience] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [imported, setImported] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  function setFields(settings: NetworkSettings, addresses?: string) {
    setHost(settings.host);
    setPort(String(settings.port));
    setOrigins(addresses);
    setAuthMode(settings.authMode);
    setIssuer(settings.authMode === 'cloudflare-access' ? settings.issuer : '');
    setAudience(settings.authMode === 'cloudflare-access' ? settings.audience : '');
  }
  function populate(next: NetworkSettingsSnapshot) {
    setSnapshot(next);
    setFields(next.settings);
    setImported(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    void request<NetworkSettingsSnapshot>(path, {}, controller.signal).then(populate, (failure) => {
      if (!controller.signal.aborted) setError(message(failure));
    });
    return () => controller.abort();
  }, [reload]);

  function loadAgain() {
    setSnapshot(undefined);
    setError('');
    setSaved(false);
    setReloadRequired(false);
    setReload((value) => value + 1);
  }

  const settings = snapshot?.settings;
  const addresses = origins ?? (settings ? allowedAddresses(settings, port) : '');
  const changed =
    !!settings &&
    (host !== settings.host ||
      port !== String(settings.port) ||
      addresses !== settings.origins.join('\n') ||
      authMode !== settings.authMode ||
      (settings.authMode === 'cloudflare-access' &&
        (issuer !== settings.issuer || audience !== settings.audience)));
  useEffect(() => {
    onDraft({ changed, busy: saving || importing });
  }, [changed, saving, importing, onDraft]);

  if (!snapshot)
    return (
      <div>
        {error ? (
          <>
            <p role="alert">{t(error)}</p>
            <button type="button" onClick={loadAgain}>
              {t('Retry loading')}
            </button>
          </>
        ) : (
          <p role="status">{t('Loading network settings…')}</p>
        )}
      </div>
    );

  async function importConfiguration(file: File) {
    if (saving || importing || reloadRequired) return;
    setError('');
    setImporting(true);
    try {
      if (file.size > 64 * 1024)
        throw new Error('Choose a configuration file no larger than 64 KiB.');
      let value: unknown;
      try {
        value = JSON.parse(await file.text());
      } catch {
        throw new Error('The selected file could not be read as JSON.');
      }
      const result = networkSettingsTransferSchema.safeParse(value);
      if (!result.success)
        throw new Error('Invalid network configuration. Choose a file exported from Codes.');
      const { settings } = result.data;
      setFields(settings, settings.origins.join('\n'));
      setSaved(false);
      setImported(true);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setImporting(false);
    }
  }
  function exportConfiguration() {
    if (!snapshot) return;
    const json =
      JSON.stringify(
        {
          format: 'codes-network-settings',
          version: 1,
          settings: snapshot.settings,
        },
        null,
        2,
      ) + '\n';
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'codes-network-settings.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function save() {
    if (!snapshot || saving || importing || !changed || reloadRequired) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const next = await request<NetworkSettingsSnapshot>(path, {
        method: 'PUT',
        body: JSON.stringify({
          revision: snapshot.revision,
          settings: {
            host,
            port: Number(port),
            origins: addresses
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean),
            ...(authMode === 'cloudflare-access' ? { authMode, issuer, audience } : { authMode }),
          },
        }),
      });
      populate(next);
      setSaved(true);
    } catch (failure) {
      setError(message(failure));
      setReloadRequired(
        failure instanceof ApiError && (failure.status === 409 || failure.uncertain),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="network-settings"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <section className="preferences-section" aria-labelledby="network-listener-heading">
        <h3 id="network-listener-heading">{t('Listener')}</h3>
        <div className="network-listener">
          <label>
            {t('Listen address')}
            <select
              value={host}
              onChange={(event) => setHost(event.target.value as typeof host)}
              disabled={saving}
            >
              {loopbackHosts.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            {t('Listen port')}
            <input
              type="number"
              min="1"
              max="65535"
              step="1"
              required
              value={port}
              onChange={(event) => setPort(event.target.value)}
              disabled={saving}
            />
          </label>
        </div>
      </section>
      <section className="preferences-section" aria-labelledby="network-access-heading">
        <h3 id="network-access-heading">{t('Browser access')}</h3>
        <div className="network-access-fields">
          <div className="network-auth-mode">
            <label>
              {t('Authentication mode')}
              <select
                value={authMode}
                onChange={(event) => setAuthMode(event.target.value as NetworkSettings['authMode'])}
                aria-describedby="network-auth-help"
                disabled={saving}
              >
                <option value="local">{t('Local / Tailscale (local)')}</option>
                <option value="cloudflare-access">Cloudflare Access</option>
              </select>
            </label>
            <p className="preference-help" id="network-auth-help">
              {authMode === 'cloudflare-access'
                ? t('Sign in with Access, then your Codes token.')
                : t('Use Cloudflare Access for public hostnames.')}
            </p>
          </div>
          {authMode === 'cloudflare-access' && (
            <div className="network-access-credentials">
              <label>
                {t('Cloudflare team URL')}
                <input
                  type="url"
                  placeholder="https://your-team.cloudflareaccess.com"
                  value={issuer}
                  maxLength={128}
                  onChange={(event) => setIssuer(event.target.value)}
                  required
                  disabled={saving}
                />
              </label>
              <label>
                {t('Application Audience (AUD)')}
                <input
                  value={audience}
                  maxLength={64}
                  spellCheck={false}
                  onChange={(event) => setAudience(event.target.value)}
                  required
                  disabled={saving}
                />
              </label>
            </div>
          )}
          <div>
            <label>
              {t('Allowed addresses')}
              <textarea
                rows={4}
                value={addresses}
                onChange={(event) => setOrigins(event.target.value)}
                aria-describedby="network-address-help"
                spellCheck={false}
                required
                disabled={saving}
              />
            </label>
            <p className="preference-help" id="network-address-help">
              {authMode === 'cloudflare-access'
                ? t('One HTTPS origin per line.')
                : t('One HTTP(S) origin per line.')}
            </p>
          </div>
        </div>
      </section>
      {imported && (
        <p role="status">
          {changed
            ? t('Imported. Review before saving.')
            : t('Imported configuration matches the saved settings.')}
        </p>
      )}
      {snapshot.restartRequired ? (
        <p role="status">
          {t('Saved. Restart Codes to apply. Currently listening on {host}, port {port}.', {
            host: snapshot.active.host,
            port: snapshot.active.port,
          })}
        </p>
      ) : saved && !changed ? (
        <p role="status">{t('Network settings saved.')}</p>
      ) : null}
      {error && <p role="alert">{t(error)}</p>}
      <div className="network-actions">
        <input
          ref={importInput}
          aria-label={t('Import network settings file')}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void importConfiguration(file);
          }}
        />
        <div className="network-transfer" role="group" aria-label={t('Network configuration file')}>
          <IconButton
            icon="upload"
            label={t('Import configuration')}
            hint={t('Import for review')}
            onClick={() => importInput.current?.click()}
            disabled={saving || importing || reloadRequired}
          />
          <IconButton
            icon="download"
            label={t('Export saved')}
            onClick={exportConfiguration}
            disabled={saving}
          />
        </div>
        {reloadRequired && (
          <button type="button" onClick={loadAgain}>
            {t('Reload settings')}
          </button>
        )}
        <button
          className="preferences-done"
          type="submit"
          aria-label={saving ? t('Saving…') : t('Save network settings')}
          disabled={!changed || saving || importing || reloadRequired}
        >
          {saving ? t('Saving…') : t('Save')}
        </button>
      </div>
    </form>
  );
}
