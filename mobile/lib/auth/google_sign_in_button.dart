import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:music_room/auth/google_web_button.dart' as web;
import 'package:music_room/core/config.dart';
import 'package:music_room/ui/widgets/widgets.dart';

// initialize() may only run once per app, whatever the number of buttons built
Future<void>? _initialized;
Future<void> _initGoogle() => _initialized ??= GoogleSignIn.instance.initialize(
  // serverClientId is refused on web; on Android it sets the ID token audience
  clientId: kIsWeb ? AppConfig.googleWebClientId : null,
  serverClientId: kIsWeb ? null : AppConfig.googleWebClientId,
);

/// "Continue with Google". Android: our button opens the account picker.
/// Web: Google's own button (the only way allowed there), the result comes as an event.
class GoogleSignInButton extends StatefulWidget {
  const GoogleSignInButton({
    super.key,
    required this.onIdToken,
    required this.onError,
  });

  /// Receives the Google ID token, to be exchanged with the API.
  final Future<void> Function(String idToken) onIdToken;
  final void Function(String message) onError;

  @override
  State<GoogleSignInButton> createState() => _GoogleSignInButtonState();
}

class _GoogleSignInButtonState extends State<GoogleSignInButton> {
  static const _configured = AppConfig.googleWebClientId != '';

  Future<void>? _ready;
  StreamSubscription<GoogleSignInAuthenticationEvent>? _events;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    if (!_configured) return;
    _ready = _initGoogle().then((_) {
      if (kIsWeb) {
        _events = GoogleSignIn.instance.authenticationEvents.listen(
          _onEvent,
          onError: _onGoogleError,
        );
      }
    });
  }

  @override
  void dispose() {
    _events?.cancel();
    super.dispose();
  }

  void _onEvent(GoogleSignInAuthenticationEvent event) {
    if (event is GoogleSignInAuthenticationEventSignIn) _exchange(event.user);
  }

  Future<void> _tap() async {
    setState(() => _busy = true);
    try {
      await _ready;
      await _exchange(await GoogleSignIn.instance.authenticate());
    } catch (e) {
      _onGoogleError(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _exchange(GoogleSignInAccount account) async {
    final idToken = account.authentication.idToken;
    // Our session replaces Google's: signing out lets the user pick another account next time
    unawaited(GoogleSignIn.instance.signOut());
    if (idToken == null) {
      widget.onError('Google did not return an identity. Please try again.');
      return;
    }
    await widget.onIdToken(idToken);
  }

  void _onGoogleError(Object e) {
    // Closing the account picker is a choice, not an error
    final canceled =
        e is GoogleSignInException &&
        e.code == GoogleSignInExceptionCode.canceled;
    if (!canceled) widget.onError('Google sign-in failed. Please try again.');
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
    if (!kIsWeb) {
      return AppButton(
        label: 'Continue with Google',
        isLoading: _busy,
        onPressed: _tap,
        icon: Icons.g_mobiledata_rounded,
      );
    }
    return FutureBuilder<void>(
      future: _ready,
      builder: (context, snapshot) =>
          snapshot.connectionState == ConnectionState.done
          ? Center(child: web.renderButton())
          : const SizedBox(height: 44),
    );
  }
}
