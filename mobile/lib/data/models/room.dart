enum RoomSelection { mine, friends, public }

enum RoomVisibility { public, private }

enum AccessPolicy {
  everyone('everyone'),
  invited('invited'),
  timeWindow('time_window');

  const AccessPolicy(this.apiValue);

  final String apiValue;
}

class Room {
  const Room({
    required this.id,
    required this.ownerId,
    required this.name,
    required this.visibility,
    required this.accessPolicy,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
    this.beaconMinor,
    this.description,
    this.windowStart,
    this.windowEnd,
    this.placeLat,
    this.placeLon,
    this.placeRadius,
  });

  final int version;
  final String id;
  final String ownerId;
  final String name;
  final String visibility;
  final String accessPolicy;
  final DateTime createdAt;
  final DateTime updatedAt;
  final int? beaconMinor;
  final String? description;
  final DateTime? windowStart;
  final DateTime? windowEnd;
  final int? placeLat;
  final int? placeLon;
  final int? placeRadius;

  factory Room.fromJson(Map<String, dynamic> j) {
    final window = j['window'] as Map<String, dynamic>?;
    final place = j['place'] as Map<String, dynamic>?;

    return Room(
      id: j['id'] as String,
      ownerId: j['ownerId'] as String,
      name: j['name'] as String,
      description: j['description'] as String?,
      visibility: j['visibility'] as String,
      accessPolicy: j['accessPolicy'] as String,
      windowStart: window == null
          ? null
          : DateTime.parse(window['start'] as String),
      windowEnd: window == null
          ? null
          : DateTime.parse(window['end'] as String),
      placeLat: place == null ? null : place['lat'],
      placeLon: place == null ? null : place['lon'],
      placeRadius: place == null ? null : place['radius'],
      beaconMinor: j['beaconMinor'] as int?,
      version: j['version'] as int,
      createdAt: DateTime.parse(j['createdAt']),
      updatedAt: DateTime.parse(j['updatedAt']),
    );
  }
}
