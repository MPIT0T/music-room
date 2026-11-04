class Profile {
  const Profile({
    required this.name,
    required this.bio,
    required this.profilePicture,
    required this.friendList,
    required this.pendingFriends,
    required this.tags,
  });

  final String name;
  final String bio;
  final String profilePicture;
  final List<String> friendList;
  final int pendingFriends;
  final List<String> tags;

  factory Profile.fromJson(Map<String, dynamic> j) {
    return Profile(
      name: j['name'] as String,
      bio: j['bio'] as String,
      profilePicture: j['profilePicture'] as String,
      friendList: j['friendList'] as List<String>,
      pendingFriends: j['pendingFriends'] as int,
      tags: j['tags'] as List<String>,
    );
  }
}
