import 'package:music_room/core/api_client.dart';
import 'package:music_room/data/models/profile.dart';

class ProfileFailure implements Exception {
  const ProfileFailure(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => 'ProfileFailure($code)';
}

class ProfileService {
  ProfileService({ApiClient? api}) : _api = api ?? ApiClient();

  final ApiClient _api;

  static const _messages = {
    'rate_limited': 'Too many changes. Please wait a moment.',
    'network_error': 'Cannot reach the server. Check your connection.',
  };

  /// The signed-in user, every visibility group included (GET /v1/me).
  Future<Me> me() => _call(() async {
    final res = await _api.get('/v1/me');
    return Me.fromJson(res.body);
  });

  /// Switches between the free and premium offers (PUT /v1/me/subscription).
  /// Simulated: no payment is involved.
  Future<void> setPlan(Plan plan) => _call(() async {
    await _api.putJson('/v1/me/subscription', {'plan': plan.name});
  });

  // Every method goes through here: the screen only ever sees a ProfileFailure
  Future<T> _call<T>(Future<T> Function() request) async {
    try {
      return await request();
    } on ApiException catch (e) {
      throw ProfileFailure(
        e.code,
        _messages[e.code] ?? 'Something went wrong. Please try again.',
      );
    }
  }
}
