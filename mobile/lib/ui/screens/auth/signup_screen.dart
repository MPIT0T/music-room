import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:music_room/ui/theme/tokens.dart';

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

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isLoading = true);
    await Future.delayed(const Duration(seconds: 1)); // API CALL
    if (!mounted) return;
    context.go('/discover');
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
                const Spacer(),
                AppButton(
                  label: 'Create account',
                  onPressed: () => _submit(),
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
