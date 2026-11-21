import { useEffect, useState } from 'react';
import {
  loopbackHosts,
  type NetworkSettingsSnapshot,
  type NetworkSettings,
} from '../shared/network-settings';
import { ApiError, message, request } from './api';

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

export function NetworkSettings() {
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

  function populate(next: NetworkSettingsSnapshot) {
    setSnapshot(next);
    setHost(next.settings.host);
    setPort(String(next.settings.port));
    setOrigins(undefined);
    setAuthMode(next.settings.authMode);
    setIssuer(next.settings.authMode === 'cloudflare-access' ? next.settings.issuer : '');
    setAudience(next.settings.authMode === 'cloudflare-access' ? next.settings.audience : '');
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

  if (!snapshot)
    return (
      <div className="preferences-content">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button type="button" onClick={loadAgain}>
              Retry loading
            </button>
          </>
        ) : (
          <p role="status">Loading network settings…</p>
        )}
      </div>
    );

  const addresses = origins ?? allowedAddresses(snapshot.settings, port);
  const authChanged =
    authMode !== snapshot.settings.authMode ||
    (snapshot.settings.authMode === 'cloudflare-access' &&
      (issuer !== snapshot.settings.issuer || audience !== snapshot.settings.audience));
  const changed =
    host !== snapshot.settings.host ||
    port !== String(snapshot.settings.port) ||
    addresses !== snapshot.settings.origins.join('\n') ||
    authChanged;
  async function save() {
    if (!snapshot || saving || !changed || reloadRequired) return;
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
      className="preferences-content network-settings"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="network-listener">
        <label>
          Listen address
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
          Listen port
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
      <div className="network-access-fields">
        <div>
          <label>
            Allowed addresses
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
              ? 'One HTTPS origin per line.'
              : 'One HTTP(S) origin per line.'}{' '}
            Use the scheme, hostname, and optional port.
          </p>
        </div>
        <div>
          <label>
            Authentication mode
            <select
              value={authMode}
              onChange={(event) => setAuthMode(event.target.value as NetworkSettings['authMode'])}
              aria-describedby="network-auth-help"
              disabled={saving}
            >
              <option value="local">Local / Tailscale (local)</option>
              <option value="cloudflare-access">Cloudflare Access</option>
            </select>
          </label>
          <p className="preference-help" id="network-auth-help">
            {authMode === 'cloudflare-access'
              ? 'Access sign-in is required on every address, followed by your Codes token.'
              : 'Use your Codes token for local or tailnet access. Select Cloudflare Access for a public hostname.'}
          </p>
        </div>
      </div>
      {authMode === 'cloudflare-access' && (
        <div className="network-access-credentials">
          <label>
            Cloudflare team URL
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
            Application Audience (AUD)
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
      {snapshot.restartRequired ? (
        <p role="status">
          Saved. Restart Codes to apply. Currently listening on {snapshot.active.host}, port{' '}
          {snapshot.active.port}.
        </p>
      ) : saved && !changed ? (
        <p role="status">Network settings saved.</p>
      ) : null}
      {error && <p role="alert">{error}</p>}
      <div className="network-actions">
        {reloadRequired && (
          <button type="button" onClick={loadAgain}>
            Reload settings
          </button>
        )}
        <button
          className="preferences-done"
          type="submit"
          disabled={!changed || saving || reloadRequired}
        >
          {saving ? 'Saving…' : 'Save network settings'}
        </button>
      </div>
    </form>
  );
}
