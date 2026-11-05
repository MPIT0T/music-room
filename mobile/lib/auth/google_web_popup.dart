// The popup exists only on web: the stub keeps Android builds compiling
export 'google_web_popup_stub.dart'
    if (dart.library.js_interop) 'google_web_popup_web.dart';
