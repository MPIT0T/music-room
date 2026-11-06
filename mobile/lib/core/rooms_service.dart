import 'package:music_room/core/api_client.dart';
import 'package:music_room/data/models/queue.dart';
import 'package:music_room/data/models/room.dart';

class RoomFailure implements Exception {
  const RoomFailure(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => 'RoomFailure($code, $message)';
}

class RoomService {
  RoomService({ApiClient? api}) : _api = api ?? ApiClient();

  final ApiClient _api;

  static const _messages = {
    'premium_required':
        'Private rooms and voting restrictions need a premium account.',
    'room_limit_reached':
        'Free accounts host one room at a time. Delete it or go premium.',
    'validation_failed': 'Error validation failed.',
    'network_error': 'Error network.',
    'unauthorized': 'Error unauthorized.',
    'track_unavailable': 'Track is unavailable.',
    'music_provider_error': 'Error from music provider',
    'music_unavailable': 'Music unavailable',
  };

  Future<Room> createRoom(
    String name,
    RoomVisibility visibility,
    AccessPolicy policy, {
    String? description,
    List<DateTime>? window,
  }) => _call(() async {
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
  });

  Future<List<Room>> listRoom() => _call(() async {
    final res = await _api.get('/v1/rooms');
    return _parse(res.body['rooms'], Room.fromJson);
  });

  Future<RoomQueue> queue(String roomId) => _call(() async {
    final res = await _api.get('/v1/room/$roomId/tracks');
    return _parse(res.body, RoomQueue.fromJson).first;
  });

  Future<RoomQueue> skip(String roomId) => _call(() async {
    final res = await _api.postJson('/v1/rooms/$roomId/skip', {}, auth: true);
    return _parse(res.body, RoomQueue.fromJson).first;
  });

  Future<String> streamUrl(String trackId) => _call(() async {
    final res = await _api.get('/v1/tracks/$trackId/stream');
    return res.body['url'];
  });

  static List<T> _parse<T>(
    Object? items,
    T Function(Map<String, dynamic>) fromJson,
  ) => (items as List)
      .map((item) => fromJson(item as Map<String, dynamic>))
      .toList();

  Future<T> _call<T>(Future<T> Function() request) async {
    try {
      return await request();
    } on ApiException catch (e) {
      throw RoomFailure(
        e.code,
        _messages[e.code] ?? 'Something went wrong. Please try again.',
      );
    }
  }
}
