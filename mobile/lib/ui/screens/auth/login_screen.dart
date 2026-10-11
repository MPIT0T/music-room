import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:music_room/ui/theme/tokens.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreen();
}

class _LoginScreen extends State<LoginScreen> {
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
      appBar: AppBar(),
      body: AppScreenBody(
        fillHeight: true,
        child: Form(
          key: _formKey,
          child: AutofillGroup(
            child: Column(
              mainAxisAlignment: .spaceEvenly,
              crossAxisAlignment: .stretch,
              children: [
                const SizedBox(height: Space.lg),
                Text("Log in", style: tt.titleLarge),
                const SizedBox(height: Space.xl),
                AppInput(
                  label: 'Email',
                  controller: _email,
                  validator: (value) => (value == null || value.isEmpty)
                      ? 'Please enter your email'
                      : null,
                  keyboardType: .emailAddress,
                  textInputAction: .next,
                  autofillHints: const [AutofillHints.email],
                ),
                const SizedBox(height: Space.lg),
                AppPasswordInput(
                  label: 'Password',
                  controller: _password,
                  onFieldSubmit: (_) => _submit(),
                ),
                const SizedBox(height: Space.sm),
                Align(
                  alignment: .centerEnd,
                  child: TextButton(
                    onPressed: () {},
                    child: const Text("Forgot your password ?"),
                  ),
                ),
                const Spacer(),
                AppButton(
                  label: 'Log in',
                  isLoading: _isLoading,
                  onPressed: _submit,
                ),
                const SizedBox(height: Space.sm),
                TextButton(
                  onPressed: () {},
                  child: const Text("New here ? Create an account"),
                ),
                const SizedBox(height: Space.lg),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
