import 'package:flutter/foundation.dart';
import 'package:music_room/auth/session_store.dart';
import 'package:music_room/core/api_client.dart';

enum SignInResult { existing, created }

/// A sign-in failure with a message ready for the user.
class AuthFailure implements Exception {
  const AuthFailure(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => 'AuthFailure($code)';
}

class AuthService {
  AuthService({ApiClient? api, SessionStore? store})
    : _api = api ?? ApiClient(),
      _store = store ?? SessionStore();

  final ApiClient _api;
  final SessionStore _store;

  static const _messages = {
    'invalid_oauth_token': 'Google sign-in failed. Please try again.',
    'oauth_email_not_verified': 'Your Google email address is not verified.',
    'already_linked':
        'This email belongs to an account linked to another Google account.',
    'oauth_unavailable': 'Google sign-in is unavailable right now.',
    'network_error': 'Cannot reach the server. Check your connection.',
  };

  /// Exchanges a Google ID token for a Music Room session (POST /v1/sessions/oauth).
  Future<SignInResult> signInWithGoogle(String idToken) async {
    final deviceId = await _store.deviceId();
    try {
      final res = await _api.postJson('/v1/sessions/oauth', {
        'provider': 'google',
        'idToken': idToken,
        'device': currentDevice(),
        'deviceId': ?deviceId,
      });
      await _store.save(res.body);
      return res.status == 201 ? SignInResult.created : SignInResult.existing;
    } on ApiException catch (e) {
      throw AuthFailure(
        e.code,
        _messages[e.code] ?? 'Sign-in failed. Please try again.',
      );
    }
  }
}

/// The `device` object of the contract. kIsWeb first: dart:io Platform does not exist on web.
@visibleForTesting
Map<String, String> currentDevice() {
  if (kIsWeb) return {'name': 'Web browser', 'platform': 'web'};
  return switch (defaultTargetPlatform) {
    TargetPlatform.iOS => {'name': 'iPhone', 'platform': 'ios'},
    _ => {'name': 'Android phone', 'platform': 'android'},
  };
}

/// Shared by the screens until the app gets a dependency-injection setup.
final authService = AuthService();
