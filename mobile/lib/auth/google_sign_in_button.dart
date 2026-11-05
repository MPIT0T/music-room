import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:music_room/auth/google_id_token.dart';
import 'package:music_room/auth/google_web_popup.dart';
import 'package:music_room/core/config.dart';
import 'package:music_room/ui/widgets/widgets.dart';

// initialize() may only run once per app, whatever the number of buttons built
Future<void>? _initialized;
Future<void> _initGoogle() => _initialized ??= GoogleSignIn.instance.initialize(
  // On Android, serverClientId sets the ID token audience to the web client
  serverClientId: AppConfig.googleWebClientId,
);

/// "Continue with Google", the same button on every platform.
/// Android: opens the account picker. Web: opens Google's sign-in page in a popup
/// (One Tap is not used: Google stops showing it after it is closed a few times).
class GoogleSignInButton extends StatefulWidget {
  const GoogleSignInButton({
    super.key,
    required this.onIdToken,
    required this.onError,
    this.label = 'Continue with Google',
  });

  /// Same button for sign-in and for linking an account from the profile.
  final String label;

  /// Receives the Google ID token, to be exchanged with the API.
  final Future<void> Function(String idToken) onIdToken;
  final void Function(String message) onError;

  @override
  State<GoogleSignInButton> createState() => _GoogleSignInButtonState();
}

class _GoogleSignInButtonState extends State<GoogleSignInButton> {
  static const _configured = AppConfig.googleWebClientId != '';

  Future<void>? _ready;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    // The web popup needs no Google library setup
    if (_configured && !kIsWeb) _ready = _initGoogle();
  }

  Future<void> _tap() => kIsWeb ? _tapWeb() : _tapAndroid();

  Future<void> _tapAndroid() async {
    setState(() => _busy = true);
    try {
      await _ready;
      final account = await GoogleSignIn.instance.authenticate();
      final idToken = account.authentication.idToken;
      // Our session replaces Google's: signing out lets the user pick another account next time
      unawaited(GoogleSignIn.instance.signOut());
      if (idToken == null) {
        widget.onError('Google did not return an identity. Please try again.');
        return;
      }
      await widget.onIdToken(idToken);
    } catch (e) {
      // Closing the account picker is a choice, not an error
      final canceled =
          e is GoogleSignInException &&
          e.code == GoogleSignInExceptionCode.canceled;
      if (!canceled) widget.onError('Google sign-in failed. Please try again.');
    } finally {
      _stopWaiting();
    }
  }

  Future<void> _tapWeb() async {
    // No spinner while the popup is open: closing it sends no signal, the button
    // must stay usable for another try
    final String? idToken;
    try {
      idToken = await googleWebPopup(AppConfig.googleWebClientId);
    } on GooglePopupException catch (e) {
      if (mounted) widget.onError(e.message);
      return;
    }
    if (idToken == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await widget.onIdToken(idToken);
    } finally {
      _stopWaiting();
    }
  }

  void _stopWaiting() {
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    if (!_configured) {
      return const AppButton(
        label: 'Google sign-in not configured',
        onPressed: null,
        icon: Icons.g_mobiledata_rounded,
      );
    }
    return AppButton(
      label: widget.label,
      isLoading: _busy,
      onPressed: _tap,
      icon: Icons.g_mobiledata_rounded,
    );
  }
}
