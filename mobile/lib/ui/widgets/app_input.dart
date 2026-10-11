import 'package:flutter/material.dart';

class AppInput extends StatelessWidget {
  const AppInput({
    super.key,
    required this.label,
    required this.controller,
    this.keyboardType,
    this.textInputAction,
    this.autofillHints,
    this.validator,
  });
  final String label;
  final TextEditingController controller;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;
  final String? Function(String?)? validator;

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final cs = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: .start,
      children: [
        Text(label, style: tt.labelLarge?.copyWith(color: cs.onSurfaceVariant)),
        TextFormField(
          controller: controller,
          keyboardType: keyboardType,
          textInputAction: textInputAction,
          autofillHints: autofillHints,
          validator: validator,
        ),
      ],
    );
  }
}

class AppPasswordInput extends StatefulWidget {
  const AppPasswordInput({
    super.key,
    required this.label,
    required this.controller,
    this.textInputAction,
    this.onFieldSubmit,
  });

  final String label;
  final TextEditingController controller;
  final TextInputAction? textInputAction;
  final void Function(String)? onFieldSubmit;

  @override
  State<AppPasswordInput> createState() => _AppPasswordInputState();
}

class _AppPasswordInputState extends State<AppPasswordInput> {
  bool _isObscure = true;

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final cs = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: .start,
      children: [
        Text(
          widget.label,
          style: tt.labelLarge?.copyWith(color: cs.onSurfaceVariant),
        ),
        TextFormField(
          obscureText: _isObscure,
          controller: widget.controller,
          textInputAction: widget.textInputAction,
          validator: (value) => (value == null || value.isEmpty)
              ? 'Please enter your password'
              : null,
          onFieldSubmitted: widget.onFieldSubmit,
          decoration: InputDecoration(
            suffixIcon: IconButton(
              tooltip: _isObscure ? 'Show password' : 'Hide password',
              icon: Icon(_isObscure ? Icons.visibility_off : Icons.visibility),
              onPressed: () => setState(() => _isObscure = !_isObscure),
            ),
          ),
        ),
      ],
    );
  }
}
