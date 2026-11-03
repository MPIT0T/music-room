import 'package:flutter/material.dart';
import 'package:music_room/ui/theme/tokens.dart';

class AppTrackCover extends StatelessWidget {
  const AppTrackCover({super.key, this.imageUrl});

  final String? imageUrl;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    final Widget loadingCover = SizedBox.expand(
      child: ColoredBox(
        color: cs.surface,
        child: Icon(
          Icons.music_note_outlined,
          color: cs.onSurfaceVariant,
          size: 50,
        ),
      ),
    );

    return AspectRatio(
      aspectRatio: 1,
      child: ClipRRect(
        borderRadius: .circular(Radi.card),
        child: imageUrl != null
            ? Image.network(
                imageUrl!,
                fit: BoxFit.cover,
                loadingBuilder: (context, child, loadingProgress) =>
                    loadingProgress == null ? child : loadingCover,
                errorBuilder: (context, error, stackTrace) => loadingCover,
              )
            : loadingCover,
      ),
    );
  }
}
