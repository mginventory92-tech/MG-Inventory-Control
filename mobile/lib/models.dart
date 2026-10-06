import 'api.dart';

class Item {
  final String id;
  final String code;
  final String name;
  final String? barcode;
  final String? category;
  final String unit;
  final double minQty;
  final bool isActive;

  Item({
    required this.id,
    required this.code,
    required this.name,
    this.barcode,
    this.category,
    required this.unit,
    required this.minQty,
    required this.isActive,
  });

  factory Item.fromJson(Map<String, dynamic> j) => Item(
        id: j['id'] as String,
        code: j['code'] as String,
        name: j['name'] as String,
        barcode: j['barcode'] as String?,
        category: j['category'] as String?,
        unit: (j['unit'] ?? 'قطعة') as String,
        minQty: toD(j['minQty']),
        isActive: (j['isActive'] ?? true) as bool,
      );
}

class Named {
  final String id;
  final String name;
  Named(this.id, this.name);
  factory Named.fromJson(Map<String, dynamic> j) => Named(j['id'] as String, j['name'] as String);
}

const docLabels = {'in': 'إذن إضافة', 'out': 'إذن صرف', 'transfer': 'تحويل'};
