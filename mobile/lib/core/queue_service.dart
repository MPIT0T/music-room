import 'package:music_room/core/api_client.dart';
import 'package:music_room/data/models/queue_item.dart';

class QueueFailure implements Exception {
  const QueueFailure(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => 'QueueFailure($code)';
}

class QueueService {
  QueueService({ApiClient? api}) : _api = api ?? ApiClient();

  final ApiClient _api;

  static const _messages = {
    'not_invited': 'Only invited members can vote in this room.',
    'outside_time_window': 'Voting is closed outside the room time window.',
    'not_queued': 'This track is already playing or has been played.',
    'not_found': 'This room does not exist anymore.',
    'network_error': 'Cannot reach the server. Check your connection.',
  };

  /// Playing track and vote queue (GET /v1/rooms/:id/tracks).
  Future<RoomQueue> queue(String roomId) => _call(() async {
    final res = await _api.get('/v1/rooms/$roomId/tracks');
    return RoomQueue.fromJson(res.body);
  });

  /// Votes for a queued item (PUT /v1/rooms/:id/tracks/:itemId/vote).
  Future<void> vote(String roomId, String itemId) => _call(
    // TODO: add location in header
    () async => await _api.putJson('/v1/rooms/$roomId/tracks/$itemId/vote', {}),
  );

  /// Removes my vote (DELETE /v1/rooms/:id/tracks/:itemId/vote).
  Future<void> unvote(String roomId, String itemId) => _call(
    // TODO: add location in header
    () async => await _api.delete('/v1/rooms/$roomId/tracks/$itemId/vote'),
  );

  // Every method goes through here: the screen only ever sees a QueueFailure
  Future<T> _call<T>(Future<T> Function() request) async {
    try {
      return await request();
    } on ApiException catch (e) {
      throw QueueFailure(
        e.code,
        _messages[e.code] ?? 'Something went wrong. Please try again.',
      );
    }
  }
}
