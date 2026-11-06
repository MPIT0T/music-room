import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:music_room/auth/session_store.dart';
import 'package:music_room/core/config.dart';
import 'package:music_room/core/server_settings.dart';

/// An API error, reduced to what the app acts on: the problem+json `code`.
/// Never carries the request body, so a token cannot end up in a log or a SnackBar.
class ApiException implements Exception {
  const ApiException(this.status, this.code);

  final int status;
  final String code;

  @override
  String toString() => 'ApiException($status, $code)';
}

class ApiResponse {
  const ApiResponse(this.status, this.body);

  final int status;
  final Map<String, dynamic> body;
}

class ApiClient {
  ApiClient({
    http.Client? httpClient,
    String? baseUrl,
    ServerSettings? server,
    SessionStore? store,
    Future<String?> Function()? userAgent,
  }) : _http = httpClient ?? http.Client(),
       // Read on every request: the address can be changed in the app at any time
       _baseUrlOf = baseUrl != null
           ? (() => baseUrl)
           : (() => server?.baseUrl ?? AppConfig.apiBaseUrl),
       _store = store ?? SessionStore(),
       _userAgent = userAgent?.call();

  final http.Client _http;
  final String Function() _baseUrlOf;
  final SessionStore _store;
  // Computed once (device info is a platform call), awaited by every request
  final Future<String?>? _userAgent;

  /// Called when the session cannot be refreshed any more: the app goes back to /welcome.
  void Function()? onSessionExpired;

  Future<bool>? _refreshing;

  static const _timeout = Duration(seconds: 15);

  String get _baseUrl => _baseUrlOf();

  Future<ApiResponse> get(String path, {bool auth = true}) =>
      send('GET', path, auth: auth);

  Future<ApiResponse> postJson(
    String path,
    Map<String, Object?> body, {
    bool auth = false,
  }) => send('POST', path, body: body, auth: auth);

  Future<ApiResponse> putJson(
    String path,
    Map<String, Object?> body, {
    bool auth = true,
  }) => send('PUT', path, body: body, auth: auth);

  Future<ApiResponse> patchJson(
    String path,
    Map<String, Object?> body, {
    bool auth = true,
  }) => send('PATCH', path, body: body, auth: auth);

  Future<ApiResponse> delete(String path, {bool auth = true}) =>
      send('DELETE', path, auth: auth);

  /// [auth]: sends the access token, and on `401 unauthorized` (expired token) refreshes
  /// the session once and replays the request.
  Future<ApiResponse> send(
    String method,
    String path, {
    Map<String, Object?>? body,
    bool auth = false,
  }) async {
    var res = await _request(method, path, body: body, auth: auth);
    // Only this code means "token expired": invalid_credentials (wrong password) must not refresh
    if (auth && res.statusCode == 401 && _code(res) == 'unauthorized') {
      if (await _refreshOnce()) {
        res = await _request(method, path, body: body, auth: auth);
      }
    }
    return _result(res);
  }

  // Single flight (contract): requests failing together wait for the same refresh,
  // otherwise the second refresh would replay a token the first one already rotated
  Future<bool> _refreshOnce() =>
      _refreshing ??= _refresh().whenComplete(() => _refreshing = null);

  Future<bool> _refresh() async {
    final token = await _store.refreshToken();
    if (token == null) {
      _expire();
      return false;
    }
    final http.Response res;
    try {
      res = await _request(
        'POST',
        '/v1/sessions/refresh',
        body: {'refreshToken': token},
      );
    } on ApiException {
      return false; // offline: keep the session, the call fails and can be retried
    }
    if (res.statusCode == 200) {
      await _store.save(_decode(res.body));
      return true;
    }
    if (res.statusCode == 409) {
      // refresh_conflict: another refresh (another tab) won, the stored tokens are new
      return await _store.refreshToken() != token;
    }
    if (res.statusCode == 401) {
      // invalid_refresh_token or refresh_token_reused: this session is over
      await _store.clearTokens();
      _expire();
    }
    return false;
  }

  void _expire() => onSessionExpired?.call();

  Future<http.Response> _request(
    String method,
    String path, {
    Map<String, Object?>? body,
    bool auth = false,
  }) async {
    final request = http.Request(method, Uri.parse('$_baseUrl$path'));
    final userAgent = await _userAgent;
    if (userAgent != null) request.headers['user-agent'] = userAgent;
    if (auth) {
      final token = await _store.accessToken();
      if (token != null) request.headers['authorization'] = 'Bearer $token';
    }
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    try {
      // A request that never answers must not freeze the app: a stuck refresh would hold
      // every authenticated call waiting on it
      return await http.Response.fromStream(await _http.send(request))
          .timeout(_timeout);
    } on TimeoutException {
      throw const ApiException(0, 'network_error');
    } on Exception {
      // ClientException, TLS handshake, DNS...: for the user, the server is unreachable
      throw const ApiException(0, 'network_error');
    }
  }

  static ApiResponse _result(http.Response res) {
    final json = _decode(res.body);
    if (res.statusCode >= 400) {
      throw ApiException(
        res.statusCode,
        json['code'] as String? ?? 'http_${res.statusCode}',
      );
    }
    return ApiResponse(res.statusCode, json);
  }

  static String? _code(http.Response res) =>
      _decode(res.body)['code'] as String?;

  static Map<String, dynamic> _decode(String body) {
    try {
      final value = body.isEmpty ? null : jsonDecode(body);
      return value is Map<String, dynamic> ? value : const {};
    } on FormatException {
      return const {};
    }
  }
}
