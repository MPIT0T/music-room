import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/auth/auth_service.dart';
import 'package:music_room/core/services.dart';

class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key});

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _formKey = GlobalKey<FormState>();
  final TextEditingController _name = TextEditingController();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _isLoading = false;
  bool _sent = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_password.text.length < 8) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Use at least 8 characters for the password.'),
        ),
      );
      return;
    }
    setState(() => _isLoading = true);
    try {
      await authService.signup(_email.text, _password.text, _name.text);
      // The account cannot log in before the email is verified (subject V.1)
      if (mounted) setState(() => _sent = true);
    } on AuthFailure catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;

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
              mainAxisAlignment: .spaceBetween,
              crossAxisAlignment: .stretch,
              children: [
                Text("Create your account", style: tt.titleLarge),
                const SizedBox(height: Space.section),
                AppInput(
                  label: 'Display name',
                  controller: _name,
                  keyboardType: .text,
                  textInputAction: .next,
                  autofillHints: const [AutofillHints.name],
                  validator: (value) => (value == null || value.isEmpty)
                      ? 'Enter your name'
                      : null,
                ),
                const SizedBox(height: Space.lg),
                AppInput(
                  label: 'Email',
                  controller: _email,
                  keyboardType: .emailAddress,
                  textInputAction: .next,
                  autofillHints: const [AutofillHints.email],
                  validator: (value) => (value == null || value.isEmpty)
                      ? 'Enter your email'
                      : null,
                ),
                const SizedBox(height: Space.lg),
                AppPasswordInput(
                  label: 'Password',
                  controller: _password,
                  textInputAction: .done,
                  onFieldSubmit: (_) => _submit(),
                ),
                if (_sent) ...[
                  const SizedBox(height: Space.lg),
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(Space.cardGap),
                      child: Text(
                        'Check your inbox: open the link we sent to verify your email, then log in.',
                      ),
                    ),
                  ),
                ],
                const Spacer(),
                AppButton(
                  label: _sent ? 'Go to login' : 'Create account',
                  onPressed: _sent ? () => context.go('/login') : _submit,
                  isLoading: _isLoading,
                ),
                const SizedBox(height: Space.lg),
                TextButton(
                  onPressed: () => context.go('/login'),
                  child: const Text('Already have an account ? Log in'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
