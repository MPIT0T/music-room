import 'dart:convert';

/// A web sign-in that cannot go on (popup blocked, Google error, token refused).
class GooglePopupException implements Exception {
  const GooglePopupException(this.message);

  final String message;

  @override
  String toString() => 'GooglePopupException($message)';
}

/// True when the ID token carries the nonce of this attempt.
/// Only the API checks the signature: this check stops a token obtained for another
/// attempt from being slipped into this one.
bool idTokenHasNonce(String idToken, String nonce) {
  final parts = idToken.split('.');
  if (parts.length != 3) return false;
  try {
    final payload = jsonDecode(
      utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
    );
    return payload is Map && payload['nonce'] == nonce;
  } on FormatException {
    return false;
  }
}
