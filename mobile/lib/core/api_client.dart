import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:music_room/core/config.dart';

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
  ApiClient({http.Client? httpClient, String? baseUrl})
    : _http = httpClient ?? http.Client(),
      _baseUrl = baseUrl ?? AppConfig.apiBaseUrl;

  final http.Client _http;
  final String _baseUrl;

  Future<ApiResponse> postJson(String path, Map<String, Object?> body) async {
    final http.Response res;
    try {
      res = await _http.post(
        Uri.parse('$_baseUrl$path'),
        headers: {'content-type': 'application/json'},
        body: jsonEncode(body),
      );
    } on http.ClientException {
      throw const ApiException(0, 'network_error');
    }

    final json = _decode(res.body);
    if (res.statusCode >= 400) {
      throw ApiException(
        res.statusCode,
        json['code'] as String? ?? 'http_${res.statusCode}',
      );
    }
    return ApiResponse(res.statusCode, json);
  }

  static Map<String, dynamic> _decode(String body) {
    try {
      final value = body.isEmpty ? null : jsonDecode(body);
      return value is Map<String, dynamic> ? value : const {};
    } on FormatException {
      return const {};
    }
  }
}
