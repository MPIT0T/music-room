class QueueTrack {
  const QueueTrack({
    required this.id,
    required this.title,
    required this.artist,
    this.durationMs,
    this.coverUrl,
  });

  final String id;
  final String title;
  final String artist;
  final int? durationMs;
  final String? coverUrl;

  factory QueueTrack.fromJson(Map<String, dynamic> j) => QueueTrack(
    id: j['id'] as String,
    title: j['title'] as String,
    artist: j['artist'] as String,
    durationMs: j['durationMs'] as int?,
    coverUrl: j['coverUrl'] as String?,
  );
}

class QueueItem {
  const QueueItem({
    required this.id,
    required this.track,
    required this.votes,
    required this.myVote,
    required this.createdAt,
  });

  final String id;
  final QueueTrack track;
  final int votes;
  final bool myVote;
  final DateTime createdAt;

  factory QueueItem.fromJson(Map<String, dynamic> j) => QueueItem(
    id: j['id'] as String,
    track: QueueTrack.fromJson(j['track'] as Map<String, dynamic>),
    votes: j['votes'] as int,
    myVote: j['myVote'] as bool,
    createdAt: DateTime.parse(j['createdAt'] as String),
  );
}

class RoomQueue {
  const RoomQueue({required this.playing, required this.queue});

  final QueueItem? playing;
  final List<QueueItem> queue;

  factory RoomQueue.fromJson(Map<String, dynamic> j) => RoomQueue(
    playing: j['playing'] != null
        ? QueueItem.fromJson(j['playing'] as Map<String, dynamic>)
        : null,
    queue: (j['queue'] as List)
        .map((e) => QueueItem.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}
