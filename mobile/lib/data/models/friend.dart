enum Friendship { none, outgoing, incoming, accepted }

class UserSummary {
  const UserSummary({
    required this.userId,
    required this.displayName,
    this.avatarUrl,
  });

  final String userId;
  final String displayName;
  final String? avatarUrl;

  factory UserSummary.fromJson(Map<String, dynamic> j) => UserSummary(
    userId: j['userId'] as String,
    displayName: j['displayName'] as String,
    avatarUrl: j['avatarUrl'] as String?,
  );
}

class FriendRequest {
  const FriendRequest({required this.user, required this.createdAt});

  final UserSummary user;
  final DateTime createdAt;

  factory FriendRequest.fromJson(Map<String, dynamic> j) => FriendRequest(
    user: UserSummary.fromJson(j),
    createdAt: DateTime.parse(j['createdAt'] as String),
  );
}

class SearchResult {
  const SearchResult({required this.user, required this.friendship});

  final UserSummary user;
  final Friendship friendship;

  factory SearchResult.fromJson(Map<String, dynamic> j) => SearchResult(
    user: UserSummary.fromJson(j),
    friendship: Friendship.values.byName(j['friendship'] as String),
  );
}
