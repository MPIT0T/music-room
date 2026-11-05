import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:web/web.dart' as web;

/// Web: flutter_secure_storage needs WebCrypto, which Chrome only gives to secure
/// pages (HTTPS or localhost). Served over http from another school computer, the
/// page is not secure and every write threw, so a login never stuck: the tokens
/// then go to localStorage as is.
/// Not weaker than the encrypted storage against an XSS: its key sits in the same
/// localStorage. It only loses the encryption at rest in the browser profile.
FlutterSecureStorage appStorage() => web.window.isSecureContext
    ? const FlutterSecureStorage()
    : const PlainWebStorage();

class PlainWebStorage extends FlutterSecureStorage {
  const PlainWebStorage();

  // Keeps our keys apart from the encrypted storage's entries
  static const _prefix = 'music_room.';

  @override
  Future<String?> read({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => web.window.localStorage.getItem('$_prefix$key');

  @override
  Future<void> write({
    required String key,
    required String? value,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (value == null) {
      web.window.localStorage.removeItem('$_prefix$key');
    } else {
      web.window.localStorage.setItem('$_prefix$key', value);
    }
  }

  @override
  Future<void> delete({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => web.window.localStorage.removeItem('$_prefix$key');
}
