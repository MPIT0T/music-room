class Track {
  const Track({
    required this.id,
    required this.title,
    required this.artist,
    this.durationMs,
    this.coverUrl,
  });

  final String id;
  final String title;
  final String artist;
  final Duration? durationMs;
  final String? coverUrl;

  factory Track.fromJson(Map<String, dynamic> j) {
    final int? duration = j['durationMs'];

    return Track(
      id: j['id'] as String,
      title: j['title'] as String,
      durationMs: duration == null
          ? null
          : Duration(milliseconds: j['durationMs'] as int),
      artist: j['artist'] as String,
      coverUrl: j['coverUrl'] as String?,
    );
  }
}
