import 'package:flutter/material.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:go_router/go_router.dart';

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      body: AppScreenBody(
        fillHeight: true,
        maxWidth: 480,
        child: Column(
          mainAxisAlignment: .spaceEvenly,
          crossAxisAlignment: .stretch,
          children: [
            const Spacer(),
            Center(
              child: SizedBox(
                height: 120,
                width: 120,
                child: Card(
                  color: cs.surfaceContainerHigh,
                  child: Icon(Icons.library_music, color: cs.primary),
                ),
              ),
            ),
            const SizedBox(height: Space.sm),
            Text("Music Room", style: tt.displaySmall, textAlign: .center),
            const SizedBox(height: Space.sm),
            Text(
              "The crowd is the DJ. Vote for the next track and pass the controls to your friends.",
              style: tt.bodyLarge,
              textAlign: .center,
            ),
            const Spacer(),
            AppButton(
              label: 'Continue with Google',
              onPressed: () {},
              icon: Icons.g_mobiledata_rounded,
            ),
            const SizedBox(height: Space.sm),
            AppButton(
              label: 'Sign up with email',
              onPressed: () => context.push('/signup'),
            ),
            const SizedBox(height: Space.md),
            TextButton(
              onPressed: () => context.push('/login'),
              child: const Text('Login'),
            ),
            const SizedBox(height: Space.lg),
          ],
        ),
      ),
    );
  }
}
