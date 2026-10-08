import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

// Thrown by routes for expected failures; the handler turns it into problem+json
export class HttpProblem extends Error {
  constructor(status, code, { title = defaultTitle(code), detail, headers } = {}) {
    super(title);
    this.status = status;
    this.code = code;
    this.title = title;
    this.detail = detail;
    this.headers = headers;
  }
}

function defaultTitle(code) {
  const text = code.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Codes for errors raised by Fastify itself (bad JSON, body too large...), by status
const FRAMEWORK_CODES = {
  400: 'bad_request',
  404: 'not_found',
  405: 'method_not_allowed',
  406: 'not_acceptable',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
};

function sendProblem(request, reply, { status, code, title = defaultTitle(code), detail, errors }) {
  // RFC 9457: a relative `type` is allowed; it identifies the problem, it does not have to resolve
  return reply
    .code(status)
    .type('application/problem+json')
    .send({
      type: `/problems/${code.replaceAll('_', '-')}`,
      title,
      status,
      code,
      detail,
      requestId: request.id,
      errors,
    });
}

export function registerProblemHandlers(app) {
  app.setErrorHandler((err, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      const errors = err.validation.map((issue) => ({
        path: issue.instancePath.slice(1).replaceAll('/', '.'),
        message: issue.message,
      }));
      return sendProblem(request, reply, { status: 400, code: 'validation_failed', errors });
    }

    if (err instanceof HttpProblem) {
      if (err.headers) reply.headers(err.headers);
      return sendProblem(request, reply, err);
    }

    const status = err.statusCode;
    if (status >= 400 && status < 500) {
      return sendProblem(request, reply, {
        status,
        code: FRAMEWORK_CODES[status] ?? 'bad_request',
      });
    }

    // Anything else is a bug: full error in the logs, nothing internal in the response
    request.log.error({ err }, 'unhandled error');
    return sendProblem(request, reply, { status: 500, code: 'internal_error' });
  });

  app.setNotFoundHandler((request, reply) =>
    sendProblem(request, reply, { status: 404, code: 'not_found' }),
  );
}
