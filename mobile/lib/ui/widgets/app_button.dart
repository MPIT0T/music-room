import 'package:flutter/material.dart';
import 'package:music_room/ui/theme/tokens.dart';

enum AppButtonVariant { primary, secondary, danger }

class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = AppButtonVariant.primary,
    this.icon,
    this.isLoading = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final AppButtonVariant variant;
  final IconData? icon;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    final Widget buttonContent = Row(
      mainAxisSize: .min,
      children: [
        if (icon != null) ...[
          Icon(icon, size: 18),
          const SizedBox(width: Space.sm),
        ],
        Text(label),
      ],
    );
    const Widget buttonLoading = SizedBox(
      height: 20,
      width: 20,
      child: CircularProgressIndicator(strokeWidth: 2),
    );

    final Widget child = isLoading ? buttonLoading : buttonContent;
    final effectiveOnPressed = isLoading ? null : onPressed;

    switch (variant) {
      case .primary:
        return FilledButton(onPressed: effectiveOnPressed, child: child);
      case .secondary:
        return OutlinedButton(
          onPressed: effectiveOnPressed,
          style: OutlinedButton.styleFrom(foregroundColor: cs.onSurface),
          child: child,
        );
      case .danger:
        return TextButton(
          onPressed: effectiveOnPressed,
          style: TextButton.styleFrom(foregroundColor: cs.error),
          child: child,
        );
    }
  }
}
