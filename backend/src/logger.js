import { randomUUID } from 'node:crypto';
import { LogController } from 'fastify';

const MAX_HEADER_LENGTH = 64;
const SECRET_KEYS = [
  'authorization',
  'cookie',
  'password',
  'token',
  'accessToken',
  'access_token',
  'refresh',
  'refreshToken',
  'refresh_token',
  'idToken',
  'id_token',
];

// pino has no recursive wildcard: cover the key at the root and up to 3 levels deep
const redactPaths = [
  'body',
  '*.body',
  'res.headers["set-cookie"]',
  ...SECRET_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`, `*.*.*.${key}`]),
];

// Client headers are untrusted: first value only, printable ASCII, bounded length
export function clientHeader(value) {
  const first = Array.isArray(value) ? value[0] : value;
  const clean = typeof first === 'string' ? first.replace(/[^\x20-\x7E]/g, '').trim() : '';
  return clean === '' ? 'unknown' : clean.slice(0, MAX_HEADER_LENGTH);
}

// pino options, passed to Fastify as `logger`
export function loggerOptions({ level = process.env.LOG_LEVEL ?? 'info', stream } = {}) {
  return {
    level,
    stream,
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    serializers: {
      // Never the raw URL: query strings can carry tokens (reset links, OAuth callbacks)
      req: (req) => ({ method: req.method, route: routeOf(req) }),
      res: (reply) => ({ statusCode: reply.statusCode }),
    },
  };
}

function routeOf(request) {
  return request.routeOptions?.url ?? 'not_found';
}

// Replaces Fastify's built-in request lines; error logs (defaultErrorLog) keep the default
class AppLogController extends LogController {
  incomingRequest() {}

  // The default writes the raw URL into the message, where redact cannot reach it
  routeNotFound() {}

  requestCompleted(error, request, reply) {
    if (this.isLogDisabled(request)) return;
    const { statusCode } = reply;
    const level = error || statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    reply.log[level](
      {
        method: request.method,
        route: routeOf(request),
        statusCode,
        durationMs: Math.round(reply.elapsedTime),
        err: error ?? undefined,
      },
      'request completed',
    );
  }
}

// Fastify-level options related to logging
export const loggingOptions = {
  // A client-supplied id could be forged to fake or pollute log correlation
  requestIdHeader: false,
  genReqId: () => randomUUID(),
  logController: new AppLogController(),
  // Every log line written during a request carries the client context
  childLoggerFactory(logger, bindings, opts, rawReq) {
    const context = {
      platform: clientHeader(rawReq.headers['x-platform']),
      device: clientHeader(rawReq.headers['x-device']),
      appVersion: clientHeader(rawReq.headers['x-app-version']),
    };
    return logger.child({ ...bindings, ...context }, opts);
  },
};

export function registerRequestLogging(app) {
  // Lets the mobile app show the id in a bug report so we can find the matching logs
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
}
