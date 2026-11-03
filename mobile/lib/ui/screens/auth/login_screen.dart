import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/auth/auth_service.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _isLoading = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _showError(BuildContext context, String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _signIn() async {
    try {
      if (!_formKey.currentState!.validate()) return;
      setState(() => _isLoading = true);
      await authService.signInWithPassword(_email.text.trim(), _password.text);
      if (!mounted) return;
      context.go('/discover');
    } on AuthFailure catch (e) {
      if (mounted) _showError(context, e.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: () => context.go('/welcome')),
      ),
      body: AppScreenBody(
        maxWidth: 480,
        fillHeight: true,
        child: Form(
          key: _formKey,
          child: AutofillGroup(
            child: Column(
              mainAxisAlignment: .spaceEvenly,
              crossAxisAlignment: .stretch,
              children: [
                Text("Log in", style: tt.titleLarge),
                const SizedBox(height: Space.xl),
                AppInput(
                  label: 'Email',
                  controller: _email,
                  validator: (value) => (value == null || value.isEmpty)
                      ? 'Enter your email'
                      : null,
                  keyboardType: .emailAddress,
                  textInputAction: .next,
                  autofillHints: const [AutofillHints.email],
                ),
                const SizedBox(height: Space.lg),
                AppPasswordInput(
                  label: 'Password',
                  controller: _password,
                  onFieldSubmit: (_) => _signIn(),
                ),
                const SizedBox(height: Space.sm),
                Align(
                  alignment: .centerEnd,
                  child: TextButton(
                    onPressed: () => context.push('/forgot-password'),
                    child: Text(
                      "Forgot your password ?",
                      style: tt.bodySmall?.copyWith(
                        color: cs.onSurfaceVariant,
                        decoration: .underline,
                      ),
                    ),
                  ),
                ),
                const Spacer(),
                AppButton(
                  label: 'Log in',
                  isLoading: _isLoading,
                  onPressed: _signIn,
                ),
                const SizedBox(height: Space.sm),
                Row(
                  mainAxisAlignment: .center,
                  children: [
                    Text(
                      "New here ?",
                      style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                    ),
                    TextButton(
                      onPressed: () => context.go('/signup'),
                      child: Text(
                        "Create an account",
                        style: tt.bodySmall?.copyWith(decoration: .underline),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
