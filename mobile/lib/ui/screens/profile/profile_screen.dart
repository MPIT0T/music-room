import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:music_room/auth/auth_service.dart';
import 'package:music_room/auth/google_sign_in_button.dart';
import 'package:music_room/core/services.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/ui/widgets/widgets.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late Future<List<String>> _providers = authService.providers();
  bool _busy = false;

  void _reload() => setState(() => _providers = authService.providers());

  void _show(String message) =>
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));

  Future<void> _run(Future<void> Function() action, String done) async {
    setState(() => _busy = true);
    try {
      await action();
      // The session may have expired meanwhile and the router left this screen
      if (!mounted) return;
      _show(done);
      _reload();
    } on AuthFailure catch (e) {
      if (mounted) _show(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // Linking needs the current password (API): a stolen session alone must not add a way in
  Future<void> _link(String idToken) async {
    final password = await _askPassword();
    if (password == null || !mounted) return;
    await _run(
      () => authService.linkGoogle(idToken, password),
      'Google account linked.',
    );
  }

  Future<String?> _askPassword() {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Confirm your password'),
        content: TextField(
          controller: controller,
          obscureText: true,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Current password'),
          onSubmitted: (value) => Navigator.of(context).pop(value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Link'),
          ),
        ],
      ),
    ).whenComplete(controller.dispose);
  }

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
            // Subject V.1: link the social network account once the account exists
            FutureBuilder<List<String>>(
              future: _providers,
              builder: (context, snapshot) {
                final providers = snapshot.data;
                if (providers == null) return const SizedBox.shrink();
                if (providers.contains('google')) {
                  return AppButton(
                    label: 'Unlink Google',
                    variant: AppButtonVariant.secondary,
                    icon: Icons.link_off,
                    isLoading: _busy,
                    onPressed: () => _run(
                      authService.unlinkGoogle,
                      'Google account unlinked.',
                    ),
                  );
                }
                return GoogleSignInButton(
                  label: 'Link Google account',
                  onIdToken: _link,
                  onError: _show,
                );
              },
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
          ],
        ),
      ),
    );
  }
}
