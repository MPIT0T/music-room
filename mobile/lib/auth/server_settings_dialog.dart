import 'package:flutter/material.dart';
import 'package:music_room/core/server_settings.dart';
import 'package:music_room/core/services.dart';

/// Lets testers point the app at another API (subject V.5), e.g. a laptop on the same Wi-Fi.
Future<void> showServerSettingsDialog(BuildContext context) {
  return showDialog<void>(
    context: context,
    builder: (context) => const _ServerSettingsDialog(),
  );
}

class _ServerSettingsDialog extends StatefulWidget {
  const _ServerSettingsDialog();

  @override
  State<_ServerSettingsDialog> createState() => _ServerSettingsDialogState();
}

class _ServerSettingsDialogState extends State<_ServerSettingsDialog> {
  final _formKey = GlobalKey<FormState>();
  late final _url = TextEditingController(text: serverSettings.baseUrl);

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    await serverSettings.save(_url.text);
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _reset() async {
    await serverSettings.reset();
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Server address'),
      content: Form(
        key: _formKey,
        child: TextFormField(
          controller: _url,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: const InputDecoration(
            hintText: 'http://192.168.1.10:3000',
          ),
          validator: (value) => ServerSettings.validate(value ?? ''),
          onFieldSubmitted: (_) => _save(),
        ),
      ),
      actions: [
        TextButton(onPressed: _reset, child: const Text('Default')),
        FilledButton(onPressed: _save, child: const Text('Save')),
      ],
    );
  }
}
