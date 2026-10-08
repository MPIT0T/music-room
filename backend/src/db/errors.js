const DEFAULTS = {
  1062: [409, 'Already exists'],
  1451: [409, 'Still referenced'],
  1452: [404, 'Not found'],
};
const BY_CONSTRAINTS = {
  fk_rooms_owner: [409, 'Delete your rooms first'],
  email: [409, 'Email already exists'],
};

export class HttpError extends Error {
  constructor(statusCode, message, options) {
    super(message, options);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

function constraintName(err) {
  return (
    err?.sqlMessage?.match(/CONSTRAINT `([^`]+)`/)?.[1] ??
    err?.sqlMessage?.match(/for key '([^'])'/)?.[1]
  );
}

export function translateDbError(err) {
  const fallback = DEFAULTS[err?.errno];
  if (!fallback) return err;
  const [status, message] = BY_CONSTRAINTS[constraintName(err)] ?? fallback;
  return new HttpError(status, message, { cause: err });
}
