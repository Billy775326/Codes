import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../shared/errors.js';
import type { CloudflareAccess } from '../shared/network-settings.js';

export function cloudflareAuthenticator(config: CloudflareAccess, key?: JWTVerifyGetKey) {
  const getKey = key ?? createRemoteJWKSet(new URL('/cdn-cgi/access/certs', config.issuer));
  return async (assertion: string | string[] | undefined) => {
    if (typeof assertion !== 'string' || !assertion)
      throw new AppError('ACCESS_REQUIRED', 'Sign in through Cloudflare Access.', 401);
    try {
      const { payload } = await jwtVerify(assertion, getKey, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp'],
      });
      if (!payload.sub || !Number.isFinite(payload.exp)) throw new Error('Invalid Access claims');
      return { subject: payload.sub, expiresAt: payload.exp! * 1000 };
    } catch {
      throw new AppError(
        'ACCESS_REQUIRED',
        'Cloudflare Access authentication is invalid or expired.',
        401,
      );
    }
  };
}
