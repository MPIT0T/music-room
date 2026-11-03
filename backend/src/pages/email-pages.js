// Browser script of the email link pages (verify-email, reset-password).
// Text is only ever set with textContent: nothing from the URL or the API is parsed as HTML.

const token = new URLSearchParams(location.search).get('token') ?? '';
// Out of the address bar and the history once read: the token is a single-use credential
history.replaceState(null, '', location.pathname);

const page = document.body.dataset.page;
const form = document.getElementById('form');
const status = document.getElementById('status');

function show(message, { error = false, done = false } = {}) {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('error', error);
  if (done) form.hidden = true;
}

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const problem = await res.json().catch(() => ({}));
  return problem.code ?? `http_${res.status}`;
}

const BAD_LINK = 'This link is invalid or has expired. Ask the app for a new one.';

const actions = {
  // A button, not an automatic call: mail scanners that open links must not use up the token
  'verify-email': async () => {
    const code = await post('/v1/users/verify-email', { token });
    if (!code)
      return show('Email verified. You can go back to the app and log in.', { done: true });
    show(code === 'invalid_token' ? BAD_LINK : 'Something went wrong. Please try again.', {
      error: true,
      done: code === 'invalid_token',
    });
  },

  'reset-password': async () => {
    const password = document.getElementById('password').value;
    if (password !== document.getElementById('confirm').value) {
      return show('The two passwords are different.', { error: true });
    }
    const code = await post('/v1/password-resets/confirm', { token, newPassword: password });
    if (!code) {
      return show('Password changed. Log in again in the app with your new password.', {
        done: true,
      });
    }
    if (code === 'validation_failed') return show('Use 8 to 128 characters.', { error: true });
    show(code === 'invalid_token' ? BAD_LINK : 'Something went wrong. Please try again.', {
      error: true,
      done: code === 'invalid_token',
    });
  },
};

if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
  show(BAD_LINK, { error: true, done: true });
} else {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await actions[page]();
    } catch {
      show('Cannot reach the server. Please try again.', { error: true });
    } finally {
      button.disabled = false;
    }
  });
}
