import { useEffect, useState } from 'react';
import { loopbackHosts, type NetworkSettingsSnapshot } from '../shared/network-settings';
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
  const changed =
    host !== snapshot.settings.host ||
    port !== String(snapshot.settings.port) ||
    addresses !== snapshot.settings.origins.join('\n');
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
            authMode: 'local',
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
        One HTTP(S) origin per line, with scheme, hostname, and optional port.
      </p>
      <dl className="network-auth">
        <dt>Authentication mode</dt>
        <dd>Local / Tailscale (local)</dd>
      </dl>
      <p className="preference-help">
        Codes listens on loopback and requires its access token. For a public hostname, use
        Cloudflare Tunnel with Protect with Access.
      </p>
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
