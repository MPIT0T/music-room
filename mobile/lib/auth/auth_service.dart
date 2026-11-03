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
    'invalid_credentials': 'Wrong email or password.',
    'email_not_verified': 'Verify your email first: check your inbox.',
    'rate_limited': 'Too many attempts. Please wait a few minutes.',
    'validation_failed':
        'Check the form: the password needs 8 to 128 characters.',
  };

  static AuthFailure _failure(ApiException e) => AuthFailure(
    e.code,
    _messages[e.code] ?? 'Something went wrong. Please try again.',
  );

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
      throw _failure(e);
    }
  }

  /// Email and password login (POST /v1/sessions). The stored deviceId is sent back so this
  /// install keeps the same device, and its control delegations, across logins.
  Future<void> login(String email, String password) async {
    final deviceId = await _store.deviceId();
    try {
      final res = await _api.postJson('/v1/sessions', {
        'email': email.trim(),
        'password': password,
        'device': currentDevice(),
        'deviceId': ?deviceId,
      });
      await _store.save(res.body);
    } on ApiException catch (e) {
      throw _failure(e);
    }
  }

  /// Always 202 when accepted: the API never tells whether the email already has an account.
  Future<void> signup(String email, String password, String displayName) =>
      _post('/v1/users', {
        'email': email.trim(),
        'password': password,
        'displayName': displayName.trim(),
      });

  Future<void> resendVerification(String email) =>
      _post('/v1/users/verify-email/resend', {'email': email.trim()});

  Future<void> forgotPassword(String email) =>
      _post('/v1/password-resets', {'email': email.trim()});

  /// Revokes this device's session on the server, then forgets the tokens. The tokens are
  /// forgotten even if the server cannot be reached: the user asked to leave.
  Future<void> logout() async {
    try {
      await _api.delete('/v1/sessions/current');
    } on ApiException {
      // already expired or offline: nothing more to revoke from here
    } finally {
      await _store.clearTokens();
    }
  }

  Future<bool> hasSession() => _store.hasSession();

  /// Login methods of the account (`password`, `google`), from GET /v1/me.
  Future<List<String>> providers() async {
    try {
      final res = await _api.get('/v1/me');
      return List<String>.from(res.body['providers'] as List? ?? const []);
    } on ApiException catch (e) {
      throw _failure(e);
    }
  }

  // Same codes as sign-in, but the user is linking from the profile: the advice differs
  static const _linkMessages = {
    'already_linked':
        'Another Google account is already linked. Unlink it first.',
    'oauth_account_in_use':
        'This Google account is already used by another Music Room account.',
    'not_linked': 'No Google account is linked.',
    'last_login_method': 'Set a password first (Forgot password), or you could not log in any more.',
  };

  /// Links a Google account to the signed-in account (PUT /v1/me/oauth/google, subject V.1).
  Future<void> linkGoogle(String idToken) => _linkCall(
    () => _api.putJson('/v1/me/oauth/google', {'idToken': idToken}),
  );

  Future<void> unlinkGoogle() =>
      _linkCall(() => _api.delete('/v1/me/oauth/google'));

  Future<void> _linkCall(Future<ApiResponse> Function() call) async {
    try {
      await call();
    } on ApiException catch (e) {
      final message = _linkMessages[e.code];
      throw message != null ? AuthFailure(e.code, message) : _failure(e);
    }
  }

  Future<void> _post(String path, Map<String, Object?> body) async {
    try {
      await _api.postJson(path, body);
    } on ApiException catch (e) {
      throw _failure(e);
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
