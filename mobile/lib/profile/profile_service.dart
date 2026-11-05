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
    'validation_failed': 'Some fields are invalid.',
    'unknown_genre': 'A genre no longer exists. Reload the page and try again.',
  };

  /// The signed-in user, every visibility group included (GET /v1/me).
  Future<Me> me() => _call(() async {
    final res = await _api.get('/v1/me');
    return Me.fromJson(res.body);
  });

  /// Saves the whole edit form (PATCH /v1/me) and returns the updated account.
  /// An empty text or a null [birthDate] clears the field; [genreIds] replaces the list.
  Future<Me> update({
    required String displayName,
    required String bio,
    required String city,
    required String phone,
    required String realName,
    required String? birthDate,
    required List<int> genreIds,
  }) => _call(() async {
    final res = await _api.patchJson('/v1/me', {
      'displayName': displayName,
      'bio': bio,
      'city': city,
      'phone': phone,
      'realName': realName,
      'birthDate': birthDate,
      'genreIds': genreIds,
    });
    return Me.fromJson(res.body);
  });

  /// Music genres a user can pick as preferences (GET /v1/genres).
  Future<List<Genre>> genres() => _call(() async {
    final res = await _api.get('/v1/genres');
    return (res.body['genres'] as List)
        .map((g) => Genre.fromJson(g as Map<String, dynamic>))
        .toList();
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
