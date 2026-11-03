// Not awaited: the answer must not depend on SMTP speed or failures.
// Only the codes are logged: SMTP error messages can quote the recipient address
export function sendInBackground(request, sending, what) {
  sending.catch((err) =>
    request.log.error({ code: err.code, responseCode: err.responseCode }, `${what} email failed`),
  );
}
