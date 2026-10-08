// MariaDB errors that mean "the client asked for something impossible", not a bug.
// Each entry is [HTTP status, problem code]; the problem handler (src/errors.js) sends them.
const DEFAULTS = {
  1062: [409, 'already_exists'], // ER_DUP_ENTRY
  1451: [409, 'still_referenced'], // ER_ROW_IS_REFERENCED_2 (RESTRICT foreign key)
  1452: [404, 'not_found'], // ER_NO_REFERENCED_ROW_2 (points to a missing row)
};

// More precise codes when MariaDB names a known constraint or index
const BY_CONSTRAINT = {
  fk_rooms_owner: [409, 'owns_rooms'],
  email: [409, 'email_taken'],
};

// "... CONSTRAINT `fk_x` ..." (1451, 1452) or "... for key 'uq_x'" (1062)
function constraintName(err) {
  const msg = err?.sqlMessage;
  return msg?.match(/CONSTRAINT `([^`]+)`/)?.[1] ?? msg?.match(/for key '([^']+)'/)?.[1];
}

// Returns { status, code } for a known MariaDB error, undefined for anything else.
// The SQL message is never part of the result: it contains the duplicated values (emails...).
export function dbErrorProblem(err) {
  const fallback = DEFAULTS[err?.errno];
  if (!fallback) return undefined;
  const [status, code] = BY_CONSTRAINT[constraintName(err)] ?? fallback;
  return { status, code };
}
