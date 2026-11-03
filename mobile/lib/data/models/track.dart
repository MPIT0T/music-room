class Track {
  const Track({
    required this.id,
    required this.name,
    required this.duration,
    required this.artistName,
    required this.albumName,
    required this.coverUrl,
    required this.audioUrl,
    required this.audioDownloadUrl,
    required this.isDownloadable,
  });

  final String id;
  final String name;
  final String artistName;
  final String albumName;
  final String coverUrl;
  final String audioUrl;
  final String audioDownloadUrl;
  final Duration duration;
  final bool isDownloadable;

  factory Track.fromJamendo(Map<String, dynamic> j) {
    return Track(
      id: j['id'] as String,
      name: j['name'] as String,
      duration: Duration(seconds: j['duration'] as int),
      artistName: j['artist_name'] as String,
      albumName: j['album_name'] as String,
      coverUrl: j['album_image'] as String,
      audioUrl: j['audio'] as String,
      audioDownloadUrl: j['audiodownload'] as String,
      isDownloadable: j['audiodownload_allowed'] as bool,
    );
  }
}
