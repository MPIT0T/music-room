import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:music_room/auth/auth_service.dart';
import 'package:music_room/auth/google_sign_in_button.dart';
import 'package:music_room/auth/server_settings_dialog.dart';
import 'package:music_room/core/services.dart';
import 'package:music_room/data/models/profile.dart';
import 'package:music_room/profile/profile_service.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/ui/widgets/widgets.dart';

class SettingsScreen extends StatefulWidget {
  // The services can be swapped in tests; the app uses the shared ones
  const SettingsScreen({super.key, this.profile, this.auth});

  final ProfileService? profile;
  final AuthService? auth;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  ProfileService get _profile => widget.profile ?? profileService;
  AuthService get _auth => widget.auth ?? authService;

  Me? _me;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final me = await _profile.me();
      if (!mounted) return;
      setState(() {
        _me = me;
        _error = null;
      });
    } on ProfileFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  // Replaces the message on screen: the answer to the last action is the one that matters
  void _show(String message) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));

  /// Runs an action, confirms it with [done], then reloads the account.
  Future<void> _run(Future<void> Function() action, String done) async {
    setState(() => _busy = true);
    try {
      await action();
      // The session may have expired meanwhile and the router left this screen
      if (!mounted) return;
      _show(done);
      await _load();
    } on AuthFailure catch (e) {
      if (mounted) _show(e.message);
    } on ProfileFailure catch (e) {
      if (mounted) _show(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _setPlan(Plan plan) => _run(
    () => _profile.setPlan(plan),
    plan == Plan.premium
        ? 'You are now premium.'
        : 'You are back on the free plan.',
  );

  Future<void> _changePassword() async {
    final passwords = await showDialog<_PasswordChange>(
      context: context,
      builder: (context) => const _ChangePasswordDialog(),
    );
    if (passwords == null || !mounted) return;
    await _run(
      () => _auth.changePassword(passwords.current, passwords.next),
      'Password changed. Your other devices are signed out.',
    );
  }

  // Linking needs the current password (API): a stolen session alone must not add a way in
  Future<void> _linkGoogle(String idToken) async {
    final password = await _askPassword();
    if (password == null || !mounted) return;
    await _run(
      () => _auth.linkGoogle(idToken, password),
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

  Future<void> _editServer() async {
    await showServerSettingsDialog(context);
    if (mounted) setState(() {}); // shows the new address
  }

  Future<void> _logout() async {
    await _auth.logout();
    if (mounted) context.go('/welcome');
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final me = _me;
    return Scaffold(
      appBar: AppBar(title: Text('Settings', style: tt.titleLarge)),
      body: me == null && _error == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(Space.screen),
              children: [
                if (_error != null) ...[
                  Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                  TextButton(onPressed: _load, child: const Text('Retry')),
                  const SizedBox(height: Space.section),
                ],
                if (me != null) ...[
                  Text('Subscription', style: tt.titleMedium),
                  const SizedBox(height: Space.sm),
                  const Text(
                    'Premium unlocks private rooms, the invited and place & time '
                    'licences, and more than one room at a time.',
                  ),
                  const SizedBox(height: Space.md),
                  SegmentedButton<Plan>(
                    segments: const [
                      ButtonSegment(value: Plan.free, label: Text('Free')),
                      ButtonSegment(
                        value: Plan.premium,
                        label: Text('Premium'),
                        icon: Icon(Icons.star_outline),
                      ),
                    ],
                    selected: {me.plan},
                    onSelectionChanged: _busy ? null : (s) => _setPlan(s.first),
                  ),
                  const SizedBox(height: Space.section),
                  Text('Account', style: tt.titleMedium),
                  if (me.hasPassword)
                    ListTile(
                      leading: const Icon(Icons.lock_outline),
                      title: const Text('Change password'),
                      enabled: !_busy,
                      onTap: _changePassword,
                    ),
                  const SizedBox(height: Space.sm),
                  // Subject V.1: link the social network account once the account exists
                  if (me.hasGoogle)
                    AppButton(
                      label: 'Unlink Google',
                      variant: AppButtonVariant.secondary,
                      icon: Icons.link_off,
                      isLoading: _busy,
                      onPressed: () =>
                          _run(_auth.unlinkGoogle, 'Google account unlinked.'),
                    )
                  else
                    GoogleSignInButton(
                      label: 'Link Google account',
                      onIdToken: _linkGoogle,
                      onError: _show,
                    ),
                  const SizedBox(height: Space.section),
                ],
                Text('Server', style: tt.titleMedium),
                // Subject V.5: the back-end address must be configurable for tests
                ListTile(
                  leading: const Icon(Icons.dns_outlined),
                  title: const Text('Server address'),
                  subtitle: Text(serverSettings.baseUrl),
                  onTap: _editServer,
                ),
                const SizedBox(height: Space.section),
                AppButton(
                  label: 'Log out',
                  variant: AppButtonVariant.danger,
                  icon: Icons.logout,
                  onPressed: _logout,
                ),
              ],
            ),
    );
  }
}

typedef _PasswordChange = ({String current, String next});

class _ChangePasswordDialog extends StatefulWidget {
  const _ChangePasswordDialog();

  @override
  State<_ChangePasswordDialog> createState() => _ChangePasswordDialogState();
}

class _ChangePasswordDialogState extends State<_ChangePasswordDialog> {
  final _formKey = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.of(context).pop((current: _current.text, next: _next.text));
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Change password'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: _current,
              obscureText: true,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Current password'),
              validator: (value) =>
                  (value ?? '').isEmpty ? 'Enter your current password' : null,
            ),
            const SizedBox(height: Space.md),
            // Same rule as the API: 8 to 128 characters
            TextFormField(
              controller: _next,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'New password'),
              validator: (value) {
                final length = (value ?? '').length;
                return length < 8 || length > 128
                    ? '8 to 128 characters'
                    : null;
              },
              onFieldSubmitted: (_) => _submit(),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _submit, child: const Text('Change')),
      ],
    );
  }
}
