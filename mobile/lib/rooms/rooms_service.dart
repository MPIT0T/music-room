import 'package:music_room/core/api_client.dart';
import 'package:music_room/core/services.dart';
import 'package:music_room/data/models/room.dart';

class RoomFailure implements Exception {
  const RoomFailure(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => 'RoomFailure($code, $message)';
}

class RoomService {
  // The shared client: a private one ignores the server address set in the app, sends no
  // User-Agent, and refreshes on its own, which the API can take for token reuse
  RoomService({ApiClient? api}) : _api = api ?? apiClient;

  final ApiClient _api;
  static const _messages = {
    'validation_failed': 'Error validation failed',
    'network_error': 'Error network',
    'unauthorized': 'Error unauthorized',
    'premium_required':
        'Private rooms and voting restrictions need a premium account.',
    'room_limit_reached':
        'Free accounts host one room at a time. Delete it or go premium.',
  };

  Future<Room> createRoom(
    String name,
    RoomVisibility visibility,
    AccessPolicy policy, {

    String? description,
    List<DateTime>? window,
  }) async {
    try {
      final res = await _api.postJson('/v1/rooms', {
        "name": name,
        "description": ?description,
        "visibility": visibility.name,
        "accessPolicy": policy.apiValue,
        "window": window == null
            ? null
            : {
                "start": window[0].toUtc().toIso8601String(),
                "end": window[1].toUtc().toIso8601String(),
              },
      }, auth: true);

      return Room.fromJson(res.body);
    } on ApiException catch (e) {
      throw RoomFailure(
        e.code,
        _messages[e.code] ?? 'Room creation failed. Please try again.',
      );
    }
  }
}

final roomService = RoomService();
