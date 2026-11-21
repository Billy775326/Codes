export const loopbackHosts = ['127.0.0.1', 'localhost', '::1'] as const;

export type CloudflareAccess = { authMode: 'cloudflare-access'; issuer: string; audience: string };

export type NetworkSettings = {
  host: (typeof loopbackHosts)[number];
  port: number;
  origins: string[];
} & ({ authMode: 'local' } | CloudflareAccess);

export type NetworkSettingsSnapshot = {
  revision: number;
  settings: NetworkSettings;
  active: NetworkSettings;
  restartRequired: boolean;
};
