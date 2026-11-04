import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:music_room/core/app_storage.dart';

/// Tokens and deviceId of this install. Keychain / Keystore on mobile; on web, the
/// browser storage (encrypted on secure pages, plain over http: see app_storage_web),
/// readable by an XSS like anything in the page.
class SessionStore {
  SessionStore([FlutterSecureStorage? storage])
    : _storage = storage ?? appStorage();

  final FlutterSecureStorage _storage;

  static const _access = 'access_token';
  static const _refresh = 'refresh_token';
  static const _device = 'device_id';

  Future<String?> accessToken() => _storage.read(key: _access);
  Future<String?> refreshToken() => _storage.read(key: _refresh);
  Future<String?> deviceId() => _storage.read(key: _device);

  Future<bool> hasSession() async => await refreshToken() != null;

  /// Stores a `session` object of the contract (login, OAuth, refresh).
  Future<void> save(Map<String, dynamic> session) async {
    await _storage.write(key: _access, value: session['accessToken'] as String);
    await _storage.write(
      key: _refresh,
      value: session['refreshToken'] as String,
    );
    await _storage.write(key: _device, value: session['deviceId'] as String);
  }

  /// Logout: the deviceId stays, so the next login reuses this device and its delegations.
  Future<void> clearTokens() async {
    await _storage.delete(key: _access);
    await _storage.delete(key: _refresh);
  }
}
