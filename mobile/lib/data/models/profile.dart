enum Plan { free, premium }

class Genre {
  const Genre({required this.id, required this.name});

  final int id;
  final String name;

  factory Genre.fromJson(Map<String, dynamic> j) =>
      Genre(id: j['id'] as int, name: j['name'] as String);
}

/// The signed-in user (GET /v1/me). The fields come in the three visibility
/// groups of the API: public, friends only, private.
class Me {
  const Me({
    required this.id,
    required this.plan,
    required this.providers,
    required this.displayName,
    required this.genres,
    this.avatarUrl,
    this.bio,
    this.city,
    this.phone,
    this.realName,
    this.birthDate,
    this.email,
  });

  final String id;
  final Plan plan;

  /// Login methods of the account: `password`, `google`.
  final List<String> providers;

  // Public
  final String displayName;
  final String? avatarUrl;
  final String? bio;
  final List<Genre> genres;

  // Friends only
  final String? city;
  final String? phone;

  // Private
  final String? realName;
  final String? birthDate; // YYYY-MM-DD
  final String? email;

  bool get hasPassword => providers.contains('password');
  bool get hasGoogle => providers.contains('google');

  factory Me.fromJson(Map<String, dynamic> j) {
    final public = j['public'] as Map<String, dynamic>;
    final friends = j['friends'] as Map<String, dynamic>;
    final private = j['private'] as Map<String, dynamic>;
    return Me(
      id: j['id'] as String,
      plan: Plan.values.byName(j['plan'] as String),
      providers: List<String>.from(j['providers'] as List),
      displayName: public['displayName'] as String,
      avatarUrl: public['avatarUrl'] as String?,
      bio: public['bio'] as String?,
      genres: (public['genres'] as List)
          .map((g) => Genre.fromJson(g as Map<String, dynamic>))
          .toList(),
      city: friends['city'] as String?,
      phone: friends['phone'] as String?,
      realName: private['realName'] as String?,
      birthDate: private['birthDate'] as String?,
      email: private['email'] as String?,
    );
  }
}
