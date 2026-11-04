import 'package:flutter_test/flutter_test.dart';
import 'package:music_room/data/models/friend.dart';

void main() {
  test('user summary without avatar', () {
    final u = UserSummary.fromJson({
      'userId': 'u1',
      'displayName': 'Max',
      'avatarUrl': null,
    });
    expect(u.displayName, 'Max');
    expect(u.avatarUrl, isNull);
  });

  test('friend request parses createdAt', () {
    final r = FriendRequest.fromJson({
      'userId': 'u1',
      'displayName': 'Max',
      'avatarUrl': null,
      'createdAt': '2026-11-02T17:30:00.000Z',
    });
    expect(r.user.userId, 'u1');
    expect(r.createdAt, DateTime.utc(2026, 11, 2, 17, 30));
  });

  test('search result maps friendship to the enum', () {
    final s = SearchResult.fromJson({
      'userId': 'u1',
      'displayName': 'Max',
      'avatarUrl': 'https://example.com/a.png',
      'friendship': 'outgoing',
    });
    expect(s.friendship, Friendship.outgoing);
  });
}
