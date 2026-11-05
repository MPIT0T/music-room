// The web needs its own choice of storage: the stub keeps Android builds compiling
export 'app_storage_stub.dart'
    if (dart.library.js_interop) 'app_storage_web.dart';
