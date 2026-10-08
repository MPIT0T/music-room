// displayName is user input: it must not be able to inject markup into the email
export function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (c) => entities[c]);
}

function render({ subject, greeting, paragraphs, action }) {
  const text = [greeting, ...paragraphs, action && `${action.label} : ${action.url}`]
    .filter(Boolean)
    .join('\n\n');
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    ...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    action && `<p><a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a></p>`,
  ]
    .filter(Boolean)
    .join('\n');
  return { subject, text, html };
}

export function verifyEmail({ displayName, link }) {
  return render({
    subject: 'Confirme ton adresse email',
    greeting: `Bonjour ${displayName},`,
    paragraphs: [
      'Bienvenue sur Music Room ! Confirme ton adresse pour pouvoir te connecter.',
      'Ce lien expire dans 24 heures.',
    ],
    action: { label: 'Confirmer mon adresse', url: link },
  });
}

// Sent instead of a second account: the sign-up answer stays the same for everyone
export function alreadyRegistered() {
  return render({
    subject: 'Tentative d’inscription avec ton adresse',
    greeting: 'Bonjour,',
    paragraphs: [
      'Quelqu’un (peut-être toi) a essayé de créer un compte Music Room avec cette adresse, mais tu en as déjà un.',
      'Si tu as oublié ton mot de passe, utilise « Mot de passe oublié » dans l’app.',
      'Si ce n’était pas toi, ignore cet email : ton compte n’a pas changé.',
    ],
  });
}

export function passwordReset({ link }) {
  return render({
    subject: 'Réinitialise ton mot de passe',
    greeting: 'Bonjour,',
    paragraphs: [
      'Tu as demandé à réinitialiser ton mot de passe Music Room.',
      'Ce lien expire dans 1 heure et ne fonctionne qu’une fois.',
      'Si ce n’était pas toi, ignore cet email : ton mot de passe ne change pas.',
    ],
    action: { label: 'Choisir un nouveau mot de passe', url: link },
  });
}
