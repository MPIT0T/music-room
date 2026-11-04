import 'package:music_room/core/api_client.dart';
import 'package:music_room/data/models/friend.dart';

class FriendsFailure implements Exception {
  const FriendsFailure(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => 'FriendsFailure($code)';
}

typedef FriendRequests = ({
  List<FriendRequest> incoming,
  List<FriendRequest> outgoing,
});

class FriendsService {
  FriendsService({ApiClient? api}) : _api = api ?? ApiClient();

  final ApiClient _api;

  static const _messages = {
    'cannot_friend_self': 'You cannot add yourself as a friend.',
    'user_not_found': 'This user no longer exists.',
    'rate_limited': 'Too many requests. Please wait a moment.',
    'network_error': 'Cannot reach the server. Check your connection.',
  };

  /// Accepted friends, sorted by name (GET /v1/friends).
  Future<List<UserSummary>> list() => _call(() async {
    final res = await _api.get('/v1/friends');
    return _parse(res.body['friends'], UserSummary.fromJson);
  });

  /// Pending requests, newest first (GET /v1/friends/requests).
  Future<FriendRequests> requests() => _call(() async {
    final res = await _api.get('/v1/friends/requests');
    return (
      incoming: _parse(res.body['incoming'], FriendRequest.fromJson),
      outgoing: _parse(res.body['outgoing'], FriendRequest.fromJson),
    );
  });

  /// Verified users whose display name starts with [query] (GET /v1/users/search).
  Future<List<SearchResult>> search(String query) => _call(() async {
    final q = Uri.encodeQueryComponent(query.trim());
    final res = await _api.get('/v1/users/search?q=$q');
    return _parse(res.body['users'], SearchResult.fromJson);
  });

  /// Sends a request, or accepts the one this user sent me (PUT /v1/friends/:userId).
  /// Returns true when we are now friends.
  Future<bool> add(String userId) => _call(() async {
    final res = await _api.send('PUT', '/v1/friends/$userId', auth: true);
    return res.body['status'] == 'accepted';
  });

  /// Refuses, cancels or removes, whatever the current state (DELETE /v1/friends/:userId).
  Future<void> remove(String userId) => _call(() async {
    await _api.delete('/v1/friends/$userId');
  });

  static List<T> _parse<T>(
    Object? items,
    T Function(Map<String, dynamic>) fromJson,
  ) => (items as List)
      .map((item) => fromJson(item as Map<String, dynamic>))
      .toList();

  // Every method goes through here: the screen only ever sees a FriendsFailure
  Future<T> _call<T>(Future<T> Function() request) async {
    try {
      return await request();
    } on ApiException catch (e) {
      throw FriendsFailure(
        e.code,
        _messages[e.code] ?? 'Something went wrong. Please try again.',
      );
    }
  }
}
