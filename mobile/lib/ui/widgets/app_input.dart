import 'package:flutter/material.dart';

class AppInput extends StatelessWidget {
  const AppInput({
    super.key,
    required this.label,
    required this.hintText,
    required this.helperText,
    this.isVisible = false,
    this.isLoading = false,
    this.onVisible,
    this.onPressed,
  });

  final String label;
  final String hintText;
  final String helperText;
  final bool isLoading;
  bool isVisible;
  final VoidCallback? onVisible;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final cs = Theme.of(context).colorScheme;

    final Widget visibleIcon = IconButton(
      onPressed: () => isVisible = !isVisible,
      icon: Icon(isVisible ? Icons.visibility : Icons.visibility_off),
    );

    return Column(
      children: [
        Text(label, style: tt.labelLarge),
        TextFormField(
          decoration: InputDecoration(
            hintText: hintText,
            helperText: helperText,
            suffixIcon: visibleIcon,
          ),
        ),
      ],
    );
  }
}
