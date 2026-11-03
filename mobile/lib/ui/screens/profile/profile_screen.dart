import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:music_room/core/services.dart';
import 'package:music_room/ui/widgets/widgets.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    return Scaffold(
      body: AppScreenBody(
        fillHeight: true,
        child: Column(
          crossAxisAlignment: .stretch,
          children: [
            Text("Profile", style: tt.titleLarge),
            const Spacer(),
            AppButton(
              label: 'Log out',
              variant: AppButtonVariant.danger,
              icon: Icons.logout,
              onPressed: () async {
                await authService.logout();
                if (context.mounted) context.go('/welcome');
              },
            ),
          ],
        ),
      ),
    );
  }
}
