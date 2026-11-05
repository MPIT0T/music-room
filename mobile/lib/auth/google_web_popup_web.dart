import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:math';

import 'package:music_room/auth/google_id_token.dart';
import 'package:web/web.dart' as web;

// Only the latest attempt is waited for: a new tap ends the previous one
Completer<String?>? _pending;

/// Opens Google's sign-in page in a popup and returns its ID token, or null when the
/// user gives up (closes the page, refuses, or comes back after 5 minutes).
Future<String?> googleWebPopup(String clientId) async {
  _finish(null);
  final state = _randomToken();
  final nonce = _randomToken();
  final url = Uri.https('accounts.google.com', '/o/oauth2/v2/auth', {
    'client_id': clientId,
    // Must match an "Authorized redirect URI" of the web OAuth client
    'redirect_uri': '${web.window.location.origin}/google_callback.html',
    'response_type': 'id_token',
    'scope': 'openid email profile',
    'state': state,
    'nonce': nonce,
    'prompt': 'select_account',
  });

  final done = Completer<String?>();
  _pending = done;
  final channel = web.BroadcastChannel('music-room-google');
  channel.onmessage = ((web.MessageEvent event) {
    final data = event.data;
    if (!data.isA<JSString>()) return;
    final Object? message;
    try {
      message = jsonDecode((data as JSString).toDart);
    } on FormatException {
      return;
    }
    // Another tab's or an older attempt's answer: not ours
    if (message is! Map || message['state'] != state) return;
    final idToken = message['idToken'];
    if (idToken is String && idTokenHasNonce(idToken, nonce)) {
      _finish(idToken, done);
    } else if (message['error'] == 'access_denied') {
      _finish(null, done);
    } else {
      _fail(
        const GooglePopupException('Google sign-in failed. Please try again.'),
        done,
      );
    }
  }).toJS;

  final popup = web.window.open(
    url.toString(),
    'google-sign-in',
    'popup,width=500,height=650',
  );
  if (popup == null) {
    _fail(
      const GooglePopupException(
        'The Google window was blocked. Allow popups for this site and try again.',
      ),
      done,
    );
  }

  try {
    // popup.closed cannot tell when the user closes it (Google's pages cut the link):
    // the button stays usable meanwhile, this only stops listening one day
    return await done.future.timeout(
      const Duration(minutes: 5),
      onTimeout: () => null,
    );
  } finally {
    channel.close();
    if (identical(_pending, done)) _pending = null;
  }
}

void _finish(String? idToken, [Completer<String?>? only]) {
  final target = only ?? _pending;
  if (target != null && !target.isCompleted) target.complete(idToken);
}

void _fail(Object error, Completer<String?> target) {
  if (!target.isCompleted) target.completeError(error);
}

String _randomToken() {
  final random = Random.secure();
  return base64UrlEncode(List.generate(24, (_) => random.nextInt(256)));
}
