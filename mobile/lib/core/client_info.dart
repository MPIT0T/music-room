import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// The User-Agent the API logger reads on every request (contract v1.1, subject V.6:
/// platform, device and app version): `MusicRoom/<version> (<platform>; <model>)`.
/// Null on web: browsers do not let a page set User-Agent.
Future<String?> buildUserAgent() async {
  if (kIsWeb) return null;
  final version = (await PackageInfo.fromPlatform()).version;
  final devices = DeviceInfoPlugin();
  if (defaultTargetPlatform == TargetPlatform.iOS) {
    return formatUserAgent(
      version,
      'ios',
      (await devices.iosInfo).utsname.machine,
    );
  }
  return formatUserAgent(version, 'android', (await devices.androidInfo).model);
}

/// Pure formatting, tested on its own. Characters that would break the API's parser
/// (`(`, `)`, `;`, spaces in the version, control characters) are replaced.
@visibleForTesting
String formatUserAgent(String version, String platform, String model) {
  String clean(String value) => String.fromCharCodes(
    value.codeUnits.map((c) => c < 32 || '();'.codeUnits.contains(c) ? 32 : c),
  ).trim();
  final safeVersion = clean(version).replaceAll(' ', '');
  final safeModel = clean(model);
  return 'MusicRoom/${safeVersion.isEmpty ? '0' : safeVersion} '
      '($platform; ${safeModel.isEmpty ? 'unknown' : safeModel})';
}
