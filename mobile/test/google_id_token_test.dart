import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:music_room/auth/google_id_token.dart';

// Unsigned token: only the payload matters here, the API checks the signature
String tokenWith(Map<String, Object?> payload) {
  String part(Object value) =>
      base64Url.encode(utf8.encode(jsonEncode(value))).replaceAll('=', '');
  return '${part({'alg': 'RS256'})}.${part(payload)}.signature';
}

void main() {
  test('accepts the token carrying the nonce of this attempt', () {
    expect(idTokenHasNonce(tokenWith({'nonce': 'n-1'}), 'n-1'), isTrue);
  });

  test('refuses a token from another attempt', () {
    expect(idTokenHasNonce(tokenWith({'nonce': 'n-2'}), 'n-1'), isFalse);
  });

  test('refuses a token without a nonce', () {
    expect(idTokenHasNonce(tokenWith({'sub': '42'}), 'n-1'), isFalse);
  });

  test('refuses anything that is not a JWT', () {
    expect(idTokenHasNonce('not-a-token', 'n-1'), isFalse);
    expect(idTokenHasNonce('a.%%%.c', 'n-1'), isFalse);
  });
}
