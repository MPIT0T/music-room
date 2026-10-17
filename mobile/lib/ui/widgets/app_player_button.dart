import 'package:flutter/material.dart';
import 'package:music_room/data/models/playback_status.dart';

class AppPlayerButton extends StatelessWidget {
  const AppPlayerButton({
    super.key,
    required this.status,
    this.onPlay,
    this.onPause,
  });

  final Stream<PlaybackStatus> status;
  final VoidCallback? onPlay;
  final VoidCallback? onPause;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder(
      stream: status,
      builder: (context, snapshot) {
        final s = snapshot.data ?? PlaybackStatus.loading;
        if (s == .loading) {
          return const SizedBox(
            width: 72,
            height: 72,
            child: Center(child: CircularProgressIndicator()),
          );
        }

        final playing = s == .playing;
        return IconButton.filled(
          style: IconButton.styleFrom(minimumSize: const Size(72, 72)),
          icon: Icon(playing ? Icons.pause : Icons.play_arrow),
          onPressed: playing ? onPause : onPlay,
        );
      },
    );
  }
}
