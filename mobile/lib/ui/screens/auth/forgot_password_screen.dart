import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:music_room/ui/theme/tokens.dart';

class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final TextEditingController _email = TextEditingController();
  bool _isLoading = false;
  bool _linkSent = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isLoading = true);
    await Future.delayed(const Duration(seconds: 1)); // API CALL
    if (!mounted) return;
    setState(() {
      _isLoading = false;
      _linkSent = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(),
      body: AppScreenBody(
        maxWidth: 480,
        fillHeight: true,
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: .stretch,
            children: [
              Text("Forgot your password ?", style: tt.titleLarge),
              const SizedBox(height: Space.sm),
              Text(
                "Enter your email and we will send you a link to\nchoose a new one.",
                style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
              ),
              const SizedBox(height: Space.lg),
              AppInput(
                label: 'Email',
                controller: _email,
                keyboardType: .emailAddress,
                textInputAction: .done,
                autofillHints: const [AutofillHints.email],
                validator: (value) => (value == null || value.isEmpty)
                    ? 'Enter your email'
                    : null,
                onFieldSubmit: (_) => _submit(),
              ),
              if (_linkSent) ...[
                const SizedBox(height: Space.lg),
                Card(
                  child: Padding(
                    padding: .all(Space.cardGap),
                    child: Row(
                      children: [
                        Icon(Icons.mail, color: cs.primary),
                        const SizedBox(width: Space.sm),
                        Expanded(
                          child: Text(
                            'If an account exists for this email, a link is on its way. Check your inbox.',
                            style: tt.bodySmall,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
              const Spacer(),
              AppButton(
                label: _linkSent ? 'Back to login' : 'Send link',
                onPressed: _linkSent ? () => context.go('/login') : _submit,
                isLoading: _isLoading,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
