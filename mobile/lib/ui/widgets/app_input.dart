import 'package:flutter/material.dart';
import 'package:music_room/ui/theme/tokens.dart';

class AppInput extends StatelessWidget {
  const AppInput({
    super.key,
    required this.label,
    required this.controller,
    this.keyboardType,
    this.textInputAction,
    this.autofillHints,
    this.validator,
    this.onFieldSubmit,
  });

  final String label;
  final TextEditingController controller;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;
  final String? Function(String?)? validator;
  final void Function(String)? onFieldSubmit;

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final cs = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: .start,
      children: [
        Text(label, style: tt.labelLarge?.copyWith(color: cs.onSurfaceVariant)),
        const SizedBox(height: Space.xs),
        TextFormField(
          controller: controller,
          keyboardType: keyboardType,
          textInputAction: textInputAction,
          autofillHints: autofillHints,
          validator: validator,
          onFieldSubmitted: onFieldSubmit,
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
        const SizedBox(height: Space.xs),
        TextFormField(
          obscureText: _isObscure,
          controller: widget.controller,
          textInputAction: widget.textInputAction,
          validator: (value) =>
              (value == null || value.isEmpty) ? 'Enter your password' : null,
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
