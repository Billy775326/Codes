import { nativeConversationRoutes } from './routes/native-conversations.js';
import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, relative } from 'node:path';
import { z } from 'zod';
import { AppError, asError, record } from '../shared/errors.js';
import type { Service } from './service.js';
import { body, json, type HttpRequest } from './http-io.js';
import { conversationRoutes } from './routes/conversations.js';
import { workspaceFileRoutes } from './routes/files.js';
import { createProjectRoutes, projectCollection } from './routes/projects.js';
import { createSettingsRoutes } from './routes/settings.js';
import { webEntrySignature } from '../shared/web-build.js';
import { readReplay, traceRead, ReadDiagnostics } from './read-diagnostics.js';
import type { NetworkConfiguration } from './network-settings.js';
import type { RuntimeConfiguration } from './runtime-settings.js';
import type { AccessToken } from './access-token.js';
import { readSettingsFile } from './settings-file.js';
import { accessTokenLimits } from '../shared/access-token.js';
import type { JWTVerifyGetKey } from 'jose';
import { cloudflareAuthenticator } from './cloudflare-access.js';

export async function application(
  service: Service,
  options: {
    network: NetworkConfiguration;
    runtime?: RuntimeConfiguration;
    token: AccessToken;
    dev?: boolean;
    test?: boolean;
    staticDir?: string;
    cloudflareKey?: JWTVerifyGetKey;
  },
) {
  const installed = readSettingsFile(join(service.store.directory, 'installation-settings.json'));
  const initialChinese =
    record(installed) && installed.version === 1 && installed.language === 'zh-CN';
  const active = options.network.active;
  const origins = active.origins.map((origin) => new URL(origin));
  const authenticateAccess =
    active.authMode === 'cloudflare-access'
      ? cloudflareAuthenticator(active, options.cloudflareKey)
      : undefined;
  const sessions = new Map<string, { expiry: number; subject: string | undefined }>();
  const attempts = new Map<string, { count: number; until: number }>();
  const clearedCookie = 'codes_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
  function verifyToken(request: IncomingMessage, supplied: string, invalid: AppError) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const ip = request.socket.remoteAddress ?? 'unknown';
    const attempt = attempts.get(ip);
    if ((attempt?.count ?? 0) >= 5 || attempts.size > 100)
      throw new AppError('LOGIN_RATE', 'Too many sign-in attempts. Try again in a minute.', 429);
    if (!options.token.matches(supplied)) {
      attempts.set(ip, { count: (attempt?.count ?? 0) + 1, until: now + 60_000 });
      throw invalid;
    }
    attempts.delete(ip);
  }
  const server = createServer();
  const vite = options.dev
    ? await (
        await import('vite')
      ).createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' })
    : undefined;
  const sessionId = (request: IncomingMessage) =>
    request.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('codes_session='))
      ?.slice('codes_session='.length);
  const authenticated = (request: IncomingMessage, subject: string | undefined) => {
    const cookie = sessionId(request);
    const session = cookie ? sessions.get(cookie) : undefined;
    return !!session && session.expiry > Date.now() && session.subject === subject;
  };
  const diagnostics = new ReadDiagnostics();
  const settingsRoutes = createSettingsRoutes(
    service,
    options.network,
    options.runtime,
    diagnostics,
  );
  const projectRoutes = createProjectRoutes(service, diagnostics, options.test);
  server.on('request', (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-frame-options', 'DENY');
    if (!options.dev)
      response.setHeader(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
    void (async () => {
      const host = request.headers.host;
      const hostOrigin = origins.find((origin) => origin.host === host);
      if (!hostOrigin) throw new AppError('HOST_DENIED', 'Host not allowed.', 403);
      const requestOrigin = origins.find(
        (origin) => origin.host === host && origin.origin === request.headers.origin,
      );
      const url = new URL(request.url ?? '/', hostOrigin);
      const method = request.method;
      if (url.pathname.startsWith('/api/') && method !== 'GET' && !requestOrigin)
        throw new AppError('ORIGIN_DENIED', 'Request origin not allowed.', 403);
      const access = authenticateAccess
        ? await authenticateAccess(request.headers['cf-access-jwt-assertion'])
        : undefined;
      if (response.destroyed) return;
      if (url.pathname === '/api/login' && method === 'POST') {
        const input = z
          .object({ token: z.string().max(accessTokenLimits.max) })
          .strict()
          .parse(await body(request));
        verifyToken(
          request,
          input.token,
          new AppError('AUTH_REQUIRED', 'The access token is incorrect.', 401),
        );
        for (const [id, session] of sessions) if (session.expiry < Date.now()) sessions.delete(id);
        if (sessions.size >= 32) sessions.delete(sessions.keys().next().value!);
        const session = randomBytes(32).toString('hex');
        const seconds = service.workspaceSettings.snapshot().settings.sessionHours * 3600;
        sessions.set(session, { expiry: Date.now() + seconds * 1000, subject: access?.subject });
        response.setHeader(
          'set-cookie',
          `codes_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${requestOrigin?.protocol === 'https:' ? '; Secure' : ''}`,
        );
        return json(response, { ok: true });
      }
      if (url.pathname.startsWith('/api/')) {
        if (!authenticated(request, access?.subject))
          throw new AppError('AUTH_REQUIRED', 'Sign in to your workspace.', 401);
        const context: HttpRequest = { request, response, url, method };
        if (
          ['/api/file-browser', '/api/image-preview', '/api/html-preview'].includes(url.pathname) &&
          (await workspaceFileRoutes(context, service)) !== false
        )
          return;
        if (url.pathname === '/api/logout' && method === 'POST') {
          sessions.delete(sessionId(request) ?? '');
          response.setHeader('set-cookie', clearedCookie);
          return json(response, { ok: true });
        }
        if (url.pathname === '/api/settings/access-token') {
          if (method === 'GET') return json(response, { source: options.token.source });
          if (method === 'PUT') {
            const input = z
              .object({
                current: z.string().max(accessTokenLimits.max),
                replacement: z.string().max(accessTokenLimits.max),
              })
              .strict()
              .parse(await body(request));
            if (!authenticated(request, access?.subject))
              throw new AppError('AUTH_REQUIRED', 'Sign in to your workspace.', 401);
            verifyToken(
              request,
              input.current,
              new AppError('CURRENT_TOKEN_INVALID', 'The current token is incorrect.', 403),
            );
            options.token.replace(input.replacement);
            sessions.clear();
            service.events.close();
            response.setHeader('set-cookie', clearedCookie);
            return json(response, { ok: true });
          }
        }
        if (url.pathname === '/api/web-build' && method === 'GET' && !options.dev) {
          const index = await readFile(join(options.staticDir ?? 'dist/web', 'index.html'), 'utf8');
          return json(response, { signature: webEntrySignature(index) });
        }
        if (url.pathname === '/api/system' && method === 'GET')
          return json(response, service.system());
        if (url.pathname === '/api/connection/codex' && (method === 'GET' || method === 'POST'))
          return json(
            response,
            await service.checkConnection(
              url.searchParams.get('projectId') ?? undefined,
              method === 'POST',
            ),
          );
        if (url.pathname === '/api/connection/codex/usage' && method === 'GET') {
          response.setHeader('cache-control', 'no-store');
          return json(
            response,
            await service.codexUsage.read(url.searchParams.get('refresh') === '1'),
          );
        }
        if (url.pathname === '/api/connection/codex/usage/reset' && method === 'POST') {
          const { key } = z
            .object({ key: z.uuid() })
            .strict()
            .parse(await body(request));
          response.setHeader('cache-control', 'no-store');
          return json(response, await service.redeemUsageReset(key));
        }
        if (url.pathname === '/api/connection/codex/login') {
          if (method === 'GET') return json(response, service.codexLogin.current());
          if (method === 'POST') return json(response, await service.codexLogin.start());
          if (method === 'DELETE') {
            const { loginId } = z
              .object({ loginId: z.uuid() })
              .strict()
              .parse(await body(request));
            return json(response, await service.codexLogin.cancel(loginId));
          }
        }
        if (url.pathname === '/api/maintenance' && method === 'POST') {
          const { action } = z
            .object({ action: z.enum(['start', 'cancel']) })
            .strict()
            .parse(await body(request));
          return json(
            response,
            action === 'start' ? service.startMaintenance() : service.cancelMaintenance(),
          );
        }
        if (url.pathname === '/api/models' && method === 'GET')
          return json(response, await service.modelSettings.models());
        if (url.pathname === '/api/permissions' && method === 'GET')
          return json(response, await service.modelSettings.permissions());
        if (url.pathname === '/api/modes' && method === 'GET')
          return json(response, await service.modelSettings.modes());
        if (
          url.pathname.startsWith('/api/settings/') &&
          (await settingsRoutes.handle(context)) !== false
        )
          return;
        if (
          url.pathname === '/api/projects' &&
          (await projectCollection(context, service)) !== false
        )
          return;
        if (
          url.pathname.startsWith('/api/conversations') &&
          (await nativeConversationRoutes(context, service, diagnostics)) !== false
        )
          return;
        const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        if (segments[1] === 'projects' && (await projectRoutes(context, segments)) !== false)
          return;
        if (
          ['threads', 'operations', 'actions'].includes(segments[1] ?? '') &&
          (await conversationRoutes(context, segments, service, diagnostics)) !== false
        )
          return;
        if (url.pathname === '/api/events' && method === 'GET') {
          const id = url.searchParams.get('threadId') ?? '';
          return traceRead(
            response,
            'events',
            id,
            async () => {
              const scope = url.searchParams.get('scope');
              if (scope === 'workspace') {
                if (id.length > 200)
                  throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
              } else if (id) {
                const thread = service.store.thread(id);
                if (!thread) throw new AppError('THREAD_NOT_FOUND', 'Conversation not found.', 404);
                service.project(thread.projectId);
              } else if (scope !== 'conversations')
                service.project(url.searchParams.get('projectId') ?? '');
              service.events.checkCapacity();
              response.writeHead(200, {
                'content-type': 'text/event-stream',
                'cache-control': 'no-store',
                connection: 'keep-alive',
                'x-accel-buffering': 'no',
              });
              response.flushHeaders();
              const expiry = setInterval(() => {
                if (!authenticated(request, access?.subject)) response.end();
              }, 30_000);
              const loginExpiry = sessions.get(sessionId(request) ?? '')?.expiry ?? Date.now();
              const streamExpiry = setTimeout(
                () => response.end(),
                Math.max(0, Math.min(loginExpiry, access?.expiresAt ?? Infinity) - Date.now()),
              );
              response.once('close', () => {
                clearInterval(expiry);
                clearTimeout(streamExpiry);
              });
              readReplay(
                service.events.subscribe(
                  id,
                  Number(url.searchParams.get('after') ?? -1),
                  url.searchParams.get('epoch') ?? '',
                  response,
                ),
              );
            },
            () => diagnostics.verbose(),
          );
        }
        throw new AppError('NOT_FOUND', 'API endpoint not found.', 404);
      }
      if (vite)
        return vite.middlewares(request, response, () => {
          response.writeHead(404);
          response.end();
        });
      if (method !== 'GET' && method !== 'HEAD')
        throw new AppError('METHOD', 'Method not allowed.', 405);
      const directory = resolve(options.staticDir ?? 'dist/web');
      const path = resolve(directory, '.' + decodeURIComponent(url.pathname));
      if (relative(directory, path).startsWith('..'))
        throw new AppError('PATH_DENIED', 'Path not allowed.', 403);
      let file = path;
      try {
        if (!(await stat(file)).isFile()) file = join(directory, 'index.html');
      } catch {
        file = join(directory, 'index.html');
      }
      const bytes =
        initialChinese && file === join(directory, 'index.html')
          ? (await readFile(file, 'utf8')).replace('<html lang="en">', '<html lang="zh-CN">')
          : await readFile(file);
      const mime: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      };
      response.writeHead(200, {
        'content-type': mime[extname(file)] ?? 'application/octet-stream',
        'cache-control': authenticateAccess
          ? 'private,no-store'
          : file.endsWith('index.html')
            ? 'no-cache'
            : 'public,max-age=3600',
      });
      response.end(method === 'HEAD' ? undefined : bytes);
    })().catch((error: unknown) => {
      if (response.destroyed) return;
      if (response.headersSent) {
        response.end();
        return;
      }
      const problem =
        error instanceof z.ZodError
          ? new AppError('VALIDATION', 'Some request fields are invalid.')
          : asError(error);
      return json(
        response,
        { error: { code: problem.code, message: problem.message, uncertain: problem.uncertain } },
        problem.status,
      );
    });
  });
  return {
    server,
    close: async () => {
      const closed = new Promise<void>((yes) => server.close(() => yes()));
      service.events.close();
      await vite?.close();
      await settingsRoutes.close();
      await service.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
