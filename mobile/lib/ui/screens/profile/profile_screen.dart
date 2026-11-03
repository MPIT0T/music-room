import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:music_room/core/services.dart';
import 'package:music_room/data/models/profile.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/ui/widgets/widgets.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  final Profile dev = const Profile(
    name: 'Yann',
    bio: 'biographie bonjour uuur foo bar lorem ipsum',
    profilePicture: '',
    friendList: ['', ''],
    pendingFriends: 5,
    tags: ['rap', 'rock', 'tech'],
  );

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text("Profile", style: tt.titleLarge)),
      body: AppScreenBody(
        fillHeight: true,
        maxWidth: 480,
        child: Column(
          crossAxisAlignment: .stretch,
          children: [
            const Spacer(),
            AppAvatar(label: dev.name),
            Center(child: Text(dev.bio)),
            Wrap(
              spacing: Space.sm,
              runSpacing: Space.sm,
              alignment: .center,
              children: dev.tags.map((t) => Chip(label: Text(t))).toList(),
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
              onPressed: () => context.go('/profile/edit-profile'),
              variant: .secondary,
            ),
            const SizedBox(height: Space.sm),
            AppButton(
              label: 'Settings',
              icon: Icons.settings_outlined,
              onPressed: () => context.go('/profile/settings'),
              variant: .secondary,
            ),
            const SizedBox(height: Space.sm),
            AppButton(
              label: 'Log out',
              variant: AppButtonVariant.danger,
              icon: Icons.logout,
              onPressed: () async {
                await authService.logout();
                if (context.mounted) context.go('/welcome');
              },
            ),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}
