import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:music_room/core/services.dart';
import 'package:music_room/data/models/profile.dart';
import 'package:music_room/profile/profile_service.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/ui/widgets/widgets.dart';

class ProfileScreen extends StatefulWidget {
  // The service can be swapped in tests; the app uses the shared one
  const ProfileScreen({super.key, this.service});

  final ProfileService? service;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  ProfileService get _service => widget.service ?? profileService;

  late Future<Me> _me = _service.me();

  void _reload() => setState(() => _me = _service.me());

  // The screen stays alive under the pages it opens: reload what they may have changed
  Future<void> _open(String path) async {
    await context.push(path);
    if (mounted) _reload();
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text('Profile', style: tt.titleLarge)),
      body: AppScreenBody(
        fillHeight: true,
        maxWidth: 480,
        child: Column(
          crossAxisAlignment: .stretch,
          children: [
            const Spacer(),
            FutureBuilder<Me>(
              future: _me,
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  final error = snapshot.error;
                  return Column(
                    children: [
                      Text(
                        error is ProfileFailure
                            ? error.message
                            : 'Something went wrong.',
                      ),
                      TextButton(
                        onPressed: _reload,
                        child: const Text('Retry'),
                      ),
                    ],
                  );
                }
                final me = snapshot.data;
                if (me == null) {
                  return const Center(child: CircularProgressIndicator());
                }
                return _summary(me, tt);
              },
            ),
            const Spacer(),
            AppButton(
              label: 'Friends',
              icon: Icons.group_outlined,
              onPressed: () => context.go('/profile/friends'),
              variant: .secondary,
            ),
            const SizedBox(height: Space.sm),
            AppButton(
              label: 'Edit Profile',
              icon: Icons.edit_outlined,
              onPressed: () => _open('/profile/edit-profile'),
              variant: .secondary,
            ),
            const SizedBox(height: Space.sm),
            AppButton(
              label: 'Settings',
              icon: Icons.settings_outlined,
              onPressed: () => _open('/profile/settings'),
              variant: .secondary,
            ),
            const Spacer(),
          ],
        ),
      ),
    );
  }

  Widget _summary(Me me, TextTheme tt) {
    return Column(
      children: [
        AppAvatar(label: me.displayName),
        const SizedBox(height: Space.md),
        Text(me.displayName, style: tt.titleLarge),
        if (me.plan == Plan.premium)
          const Chip(avatar: Icon(Icons.star_outline), label: Text('Premium')),
        if (me.bio != null) ...[
          const SizedBox(height: Space.sm),
          Text(me.bio!, textAlign: TextAlign.center),
        ],
        const SizedBox(height: Space.md),
        Wrap(
          spacing: Space.sm,
          runSpacing: Space.sm,
          alignment: .center,
          children: [for (final g in me.genres) Chip(label: Text(g.name))],
        ),
      ],
    );
  }
}
