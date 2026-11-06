import 'package:music_room/data/models/track.dart';

class QueueItem {
  const QueueItem({
    required this.id,
    required this.track,
    required this.votes,
    required this.myVote,
  });

  final String id;
  final Track track;
  final int votes;
  final bool myVote;

  factory QueueItem.fromjson(Map<String, dynamic> j) {
    return QueueItem(
      id: j['id'] as String,
      track: Track.fromJson(j['track']),
      votes: j['votes'] as int,
      myVote: j['myVote'] as bool,
    );
  }
}

class RoomQueue {
  const RoomQueue({required this.playing, required this.queue});

  final QueueItem? playing;
  final List<QueueItem> queue;

  factory RoomQueue.fromJson(Map<String, dynamic> j) {
    final Map<String, dynamic>? playing = j['playing'];
    final List<Map<String, dynamic>> list = j['queue'];

    return RoomQueue(
      playing: playing == null ? null : QueueItem.fromjson(playing),
      queue: list.map((q) => QueueItem.fromjson(q)).toList(),
    );
  }
}
