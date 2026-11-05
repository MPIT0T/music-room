import 'package:flutter/material.dart';
import 'package:music_room/data/models/profile.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/ui/widgets/widgets.dart';

/// The public part of a profile, the same on my profile and on someone else's.
class ProfileHeader extends StatelessWidget {
  const ProfileHeader({
    super.key,
    required this.displayName,
    required this.genres,
    this.bio,
    this.premium = false,
  });

  final String displayName;
  final List<Genre> genres;
  final String? bio;
  final bool premium;

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    return Column(
      children: [
        AppAvatar(label: displayName),
        const SizedBox(height: Space.md),
        Text(displayName, style: tt.titleLarge),
        if (premium)
          const Chip(avatar: Icon(Icons.star_outline), label: Text('Premium')),
        if (bio != null) ...[
          const SizedBox(height: Space.sm),
          Text(bio!, textAlign: TextAlign.center),
        ],
        const SizedBox(height: Space.md),
        Wrap(
          spacing: Space.sm,
          runSpacing: Space.sm,
          alignment: .center,
          children: [for (final g in genres) Chip(label: Text(g.name))],
        ),
      ],
    );
  }
}
