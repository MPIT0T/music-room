import 'package:flutter/material.dart';
import 'package:music_room/core/services.dart';
import 'package:music_room/data/models/profile.dart';
import 'package:music_room/profile/profile_service.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/ui/widgets/widgets.dart';

// Same limits as PATCH /v1/me
const _maxGenres = 20;
final _phonePattern = RegExp(r'^[0-9 +().-]{3,30}$');

class EditProfileScreen extends StatefulWidget {
  // The service can be swapped in tests; the app uses the shared one
  const EditProfileScreen({super.key, this.service});

  final ProfileService? service;

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  ProfileService get _service => widget.service ?? profileService;

  final _formKey = GlobalKey<FormState>();
  final _displayName = TextEditingController();
  final _bio = TextEditingController();
  final _city = TextEditingController();
  final _phone = TextEditingController();
  final _realName = TextEditingController();
  String? _birthDate; // YYYY-MM-DD
  String? _email;
  final _genreIds = <int>{};
  List<Genre> _genres = const [];

  bool _loaded = false;
  String? _error;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _displayName.dispose();
    _bio.dispose();
    _city.dispose();
    _phone.dispose();
    _realName.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final me = await _service.me();
      final genres = await _service.genres();
      if (!mounted) return;
      setState(() {
        _fill(me);
        _genres = genres;
        _loaded = true;
      });
    } on ProfileFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  void _fill(Me me) {
    _displayName.text = me.displayName;
    _bio.text = me.bio ?? '';
    _city.text = me.city ?? '';
    _phone.text = me.phone ?? '';
    _realName.text = me.realName ?? '';
    _birthDate = me.birthDate;
    _email = me.email;
    _genreIds
      ..clear()
      ..addAll(me.genres.map((g) => g.id));
  }

  void _show(String message) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));

  Future<void> _pickBirthDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(_birthDate ?? '') ?? DateTime(2000),
      // The API takes a past date after 1900
      firstDate: DateTime(1900),
      lastDate: DateTime(now.year, now.month, now.day - 1),
    );
    if (picked != null) {
      setState(() => _birthDate = picked.toIso8601String().substring(0, 10));
    }
  }

  void _toggleGenre(Genre genre, bool selected) => setState(
    () => selected ? _genreIds.add(genre.id) : _genreIds.remove(genre.id),
  );

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      await _service.update(
        displayName: _displayName.text,
        bio: _bio.text,
        city: _city.text,
        phone: _phone.text,
        realName: _realName.text,
        birthDate: _birthDate,
        genreIds: _genreIds.toList(),
      );
      if (!mounted) return;
      _show('Profile saved.');
      Navigator.of(context).pop();
    } on ProfileFailure catch (e) {
      if (mounted) _show(e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text('Edit profile', style: tt.titleLarge)),
      body: _loaded
          ? _form(tt)
          : Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : Column(
                      mainAxisSize: .min,
                      children: [
                        Text(_error!),
                        TextButton(
                          onPressed: _load,
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
            ),
    );
  }

  Widget _form(TextTheme tt) {
    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(Space.screen),
        children: [
          const _SectionTitle('Public', 'Everyone can see this.'),
          AppInput(
            label: 'Display name',
            controller: _displayName,
            maxLength: 50,
            validator: (value) =>
                (value ?? '').trim().isEmpty ? 'Enter a display name' : null,
          ),
          const SizedBox(height: Space.md),
          AppInput(
            label: 'Bio',
            controller: _bio,
            keyboardType: TextInputType.multiline,
            maxLength: 500,
            maxLines: 4,
          ),
          const SizedBox(height: Space.md),
          Text('Music preferences ${_genreIds.length}/$_maxGenres'),
          const SizedBox(height: Space.sm),
          if (_genres.isEmpty) const Text('No genres available yet.'),
          Wrap(
            spacing: Space.sm,
            runSpacing: Space.sm,
            children: [
              for (final genre in _genres)
                FilterChip(
                  label: Text(genre.name),
                  selected: _genreIds.contains(genre.id),
                  // Once the limit is reached, only removing a genre is possible
                  onSelected:
                      _genreIds.contains(genre.id) ||
                          _genreIds.length < _maxGenres
                      ? (selected) => _toggleGenre(genre, selected)
                      : null,
                ),
            ],
          ),
          const SizedBox(height: Space.section),
          const _SectionTitle('Friends', 'Only your friends can see this.'),
          AppInput(label: 'City', controller: _city, maxLength: 100),
          const SizedBox(height: Space.md),
          AppInput(
            label: 'Phone',
            controller: _phone,
            keyboardType: TextInputType.phone,
            maxLength: 30,
            validator: (value) {
              final phone = (value ?? '').trim();
              return phone.isEmpty || _phonePattern.hasMatch(phone)
                  ? null
                  : 'Digits, spaces and + ( ) . - only';
            },
          ),
          const SizedBox(height: Space.section),
          const _SectionTitle('Private', 'Only you can see this.'),
          AppInput(label: 'Real name', controller: _realName, maxLength: 100),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.cake_outlined),
            title: const Text('Birth date'),
            subtitle: Text(_birthDate ?? 'Not set'),
            onTap: _pickBirthDate,
            trailing: _birthDate == null
                ? null
                : IconButton(
                    tooltip: 'Clear birth date',
                    icon: const Icon(Icons.clear),
                    onPressed: () => setState(() => _birthDate = null),
                  ),
          ),
          // The email is the login: it is shown here but cannot be edited
          if (_email != null)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.mail_outline),
              title: const Text('Email'),
              subtitle: Text(_email!),
            ),
          const SizedBox(height: Space.section),
          AppButton(label: 'Save', isLoading: _saving, onPressed: _save),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title, this.visibility);

  final String title;
  final String visibility;

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: Space.md),
      child: Column(
        crossAxisAlignment: .start,
        children: [
          Text(title, style: tt.titleMedium),
          Text(visibility, style: tt.bodySmall),
        ],
      ),
    );
  }
}
