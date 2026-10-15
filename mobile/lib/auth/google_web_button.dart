// renderButton exists only in the web implementation: the stub keeps Android builds compiling
export 'google_web_button_stub.dart'
    if (dart.library.js_interop) 'package:google_sign_in_web/web_only.dart';
