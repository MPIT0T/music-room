import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:music_room/core/config.dart';
import 'package:music_room/ui/widgets/widgets.dart';

// initialize() may only run once per app, whatever the number of buttons built
Future<void>? _initialized;
Future<void> _initGoogle() => _initialized ??= GoogleSignIn.instance.initialize(
  // serverClientId is refused on web; on Android it sets the ID token audience
  clientId: kIsWeb ? AppConfig.googleWebClientId : null,
  serverClientId: kIsWeb ? null : AppConfig.googleWebClientId,
);

/// "Continue with Google", the same button on every platform.
/// Android: opens the account picker. Web: authenticate() does not exist there, so the
/// button asks for Google's One Tap prompt and the result comes as an event.
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
  Timer? _noPrompt;
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
    _noPrompt?.cancel();
    super.dispose();
  }

  Future<void> _onEvent(GoogleSignInAuthenticationEvent event) async {
    if (event is GoogleSignInAuthenticationEventSignIn) {
      await _exchange(event.user);
    }
    _stopWaiting();
  }

  Future<void> _tap() => kIsWeb ? _tapWeb() : _tapAndroid();

  Future<void> _tapAndroid() async {
    setState(() => _busy = true);
    try {
      await _ready;
      await _exchange(await GoogleSignIn.instance.authenticate());
    } catch (e) {
      _onGoogleError(e);
    } finally {
      _stopWaiting();
    }
  }

  Future<void> _tapWeb() async {
    setState(() => _busy = true);
    await _ready;
    GoogleSignIn.instance.attemptLightweightAuthentication();
    // Google sends nothing when it decides not to show One Tap (paused after the user
    // closed it several times): without this, the button would spin forever
    _noPrompt?.cancel();
    _noPrompt = Timer(const Duration(seconds: 30), () {
      if (!_busy) return;
      _stopWaiting();
      widget.onError(
        'No Google window? Google pauses it after it is closed. Try again later.',
      );
    });
  }

  void _stopWaiting() {
    _noPrompt?.cancel();
    if (mounted) setState(() => _busy = false);
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
    _stopWaiting();
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
    return AppButton(
      label: 'Continue with Google',
      isLoading: _busy,
      onPressed: _tap,
      icon: Icons.g_mobiledata_rounded,
    );
  }
}
