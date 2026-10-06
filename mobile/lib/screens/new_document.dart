import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../models.dart';
import 'common.dart';

class _Line {
  final Item item;
  final TextEditingController qty;
  _Line(this.item, double q) : qty = TextEditingController(text: fmt(q));
  double get value => double.tryParse(qty.text.trim()) ?? 0;
}

/// One screen for the three document kinds: 'in' (receipt), 'out' (issue), 'transfer'.
class NewDocumentScreen extends StatefulWidget {
  final String type;
  const NewDocumentScreen({super.key, required this.type});
  @override
  State<NewDocumentScreen> createState() => _NewDocumentScreenState();
}

class _NewDocumentScreenState extends State<NewDocumentScreen> {
  List<Named> _warehouses = [];
  List<Named> _parties = [];
  String? _fromId;
  String? _toId;
  String? _partyId;
  DateTime _date = DateTime.now();
  final _reference = TextEditingController();
  final _notes = TextEditingController();
  final _search = TextEditingController();
  final List<_Line> _lines = [];
  List<Item> _results = [];
  Map<String, double> _avail = {};
  Timer? _debounce;
  bool _loading = true;
  bool _busy = false;
  String? _error;
  String? _searchMsg;

  String get _type => widget.type;
  bool get _needsFrom => _type != 'in';
  bool get _needsTo => _type != 'out';

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    for (final l in _lines) {
      l.qty.dispose();
    }
    super.dispose();
  }

  Future<void> _init() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final w = await Api.I.get('/warehouses') as List;
      final partyType = _type == 'in' ? 'supplier' : _type == 'out' ? 'customer' : null;
      final p = partyType == null ? <dynamic>[] : await Api.I.get('/parties${Api.query({'type': partyType})}') as List;
      if (!mounted) return;
      setState(() {
        _warehouses = w.map((e) => Named.fromJson(Map<String, dynamic>.from(e as Map))).toList();
        _parties = p.map((e) => Named.fromJson(Map<String, dynamic>.from(e as Map))).toList();
        if (_warehouses.length == 1) {
          if (_needsFrom) _fromId = _warehouses.first.id;
          if (_needsTo) _toId = _warehouses.first.id;
        }
      });
      await _loadAvail();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadAvail() async {
    if (!_needsFrom || _fromId == null) {
      setState(() => _avail = {});
      return;
    }
    try {
      final d = await Api.I.get('/stock/available${Api.query({'warehouseId': _fromId})}') as Map;
      if (mounted) setState(() => _avail = d.map((k, v) => MapEntry(k as String, toD(v))));
    } on ApiException {
      if (mounted) setState(() => _avail = {});
    }
  }

  void _addItem(Item item) {
    final i = _lines.indexWhere((l) => l.item.id == item.id);
    setState(() {
      if (i >= 0) {
        _lines[i].qty.text = fmt(_lines[i].value + 1);
      } else {
        _lines.add(_Line(item, 1));
      }
      _search.clear();
      _results = [];
      _searchMsg = null;
    });
  }

  Future<bool> _addByCode(String code) async {
    try {
      final d = await Api.I.get('/items/lookup/${Uri.encodeComponent(code.trim())}');
      _addItem(Item.fromJson(Map<String, dynamic>.from(d as Map)));
      return true;
    } on ApiException {
      return false;
    }
  }

  void _onSearchChanged(String text) {
    _debounce?.cancel();
    setState(() => _searchMsg = null);
    if (text.trim().isEmpty) {
      setState(() => _results = []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 250), () async {
      try {
        final d = await Api.I.get('/items${Api.query({'q': text.trim()})}') as List;
        if (mounted) setState(() => _results = d.take(8).map((e) => Item.fromJson(Map<String, dynamic>.from(e as Map))).toList());
      } on ApiException {
        // ignore: the next keystroke retries
      }
    });
  }

  Future<void> _submitSearch(String text) async {
    final t = text.trim();
    if (t.isEmpty) return;
    if (await _addByCode(t)) return;
    if (_results.length == 1) return _addItem(_results.first);
    if (mounted) setState(() => _searchMsg = _results.isEmpty ? 'لا يوجد صنف مطابق لـ "$t"' : 'اختر الصنف من القائمة');
  }

  Future<void> _scan() async {
    final code = await scanBarcode(context);
    if (code == null) return;
    if (!await _addByCode(code) && mounted) setState(() => _searchMsg = 'لا يوجد صنف بالباركود $code');
  }

  bool _over(_Line l) => _needsFrom && l.value > (_avail[l.item.id] ?? 0);

  Future<void> _save() async {
    setState(() => _error = null);
    if (_needsFrom && _fromId == null) return setState(() => _error = 'اختر المخزن المصروف منه');
    if (_needsTo && _toId == null) return setState(() => _error = 'اختر المخزن المستلم');
    if (_type == 'transfer' && _fromId == _toId) return setState(() => _error = 'لا يمكن التحويل لنفس المخزن');
    if (_lines.isEmpty) return setState(() => _error = 'أضف صنف واحد على الأقل');
    if (_lines.any((l) => l.value <= 0)) return setState(() => _error = 'كل الكميات لازم تكون أكبر من صفر');
    if (_lines.any(_over)) return setState(() => _error = 'في أصناف كميتها أكبر من الرصيد المتاح');

    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final nav = Navigator.of(context);
    try {
      final doc = await Api.I.post('/documents', {
        'type': _type,
        'date': _date.toIso8601String().substring(0, 10),
        if (_needsFrom) 'fromWarehouseId': _fromId,
        if (_needsTo) 'toWarehouseId': _toId,
        if (_partyId != null) 'partyId': _partyId,
        if (_reference.text.trim().isNotEmpty) 'reference': _reference.text.trim(),
        if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
        'lines': [for (final l in _lines) {'itemId': l.item.id, 'qty': l.value}],
      });
      messenger.showSnackBar(SnackBar(content: Text('تم تسجيل ${docLabels[_type]} رقم ${doc['number']}')));
      nav.pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickDate() async {
    final d = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2020), lastDate: DateTime(2100));
    if (d != null) setState(() => _date = d);
  }

  Widget _warehouseDropdown(String label, String? value, ValueChanged<String?> onChanged) => DropdownButtonFormField<String>(
        value: value,
        isExpanded: true,
        decoration: InputDecoration(labelText: label),
        items: [for (final w in _warehouses) DropdownMenuItem(value: w.id, child: Text(w.name))],
        onChanged: onChanged,
      );

  @override
  Widget build(BuildContext context) {
    final title = {'in': 'إذن إضافة للمخزن', 'out': 'إذن صرف من المخزن', 'transfer': 'تحويل بين المخازن'}[_type]!;
    final searchDisabled = _needsFrom && _fromId == null;
    return Scaffold(
      appBar: brandedAppBar(Text(title)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(padding: const EdgeInsets.all(16), children: [
              if (_error != null)
                Container(
                  padding: const EdgeInsets.all(10),
                  margin: const EdgeInsets.only(bottom: 12),
                  color: const Color(0xFFFBE7E2),
                  child: Text(_error!, style: const TextStyle(color: Color(0xFFAD3320))),
                ),
              OutlinedButton.icon(
                onPressed: _pickDate,
                icon: const Icon(Icons.calendar_today, size: 18),
                label: Text('التاريخ: ${_date.toIso8601String().substring(0, 10)}'),
              ),
              const SizedBox(height: 12),
              if (_needsFrom)
                _warehouseDropdown(_type == 'out' ? 'المخزن المصروف منه' : 'من مخزن', _fromId, (v) {
                  setState(() => _fromId = v);
                  _loadAvail();
                }),
              if (_needsFrom && _needsTo) const SizedBox(height: 12),
              if (_needsTo) _warehouseDropdown(_type == 'in' ? 'المخزن المستلم' : 'إلى مخزن', _toId, (v) => setState(() => _toId = v)),
              if (_type != 'transfer') ...[
                const SizedBox(height: 12),
                DropdownButtonFormField<String?>(
                  value: _partyId,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: _type == 'in' ? 'المورد' : 'العميل / الجهة المستلمة'),
                  items: [
                    const DropdownMenuItem<String?>(value: null, child: Text('بدون')),
                    for (final p in _parties) DropdownMenuItem<String?>(value: p.id, child: Text(p.name)),
                  ],
                  onChanged: (v) => setState(() => _partyId = v),
                ),
              ],
              const SizedBox(height: 12),
              TextField(controller: _reference, decoration: const InputDecoration(labelText: 'رقم المرجع')),
              const SizedBox(height: 12),
              TextField(controller: _notes, decoration: const InputDecoration(labelText: 'ملاحظات')),
              const Divider(height: 32),
              Text('الأصناف', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              TextField(
                controller: _search,
                enabled: !searchDisabled,
                onChanged: _onSearchChanged,
                onSubmitted: _submitSearch,
                decoration: InputDecoration(
                  hintText: searchDisabled ? 'اختر المخزن أولاً' : 'باركود / كود / اسم الصنف',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: IconButton(icon: const Icon(Icons.qr_code_scanner), tooltip: 'مسح بالكاميرا', onPressed: searchDisabled ? null : _scan),
                ),
              ),
              if (_searchMsg != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(_searchMsg!, style: const TextStyle(color: Color(0xFFAD3320)))),
              for (final r in _results)
                Card(margin: const EdgeInsets.only(top: 4), child: ListTile(dense: true, title: Text(r.name), subtitle: Text(r.code), onTap: () => _addItem(r))),
              const SizedBox(height: 8),
              if (_lines.isEmpty)
                const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Text('امسح الباركود أو ابحث بالاسم لإضافة صنف.', style: TextStyle(color: Color(0xFF5D6877)))),
              for (var i = 0; i < _lines.length; i++) _lineTile(i),
              const SizedBox(height: 20),
              FilledButton(onPressed: _busy || _lines.isEmpty ? null : _save, child: Text(_busy ? 'جاري الحفظ…' : 'حفظ ${docLabels[_type]}')),
            ]),
    );
  }

  Widget _lineTile(int i) {
    final l = _lines[i];
    final over = _over(l);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(l.item.name, style: const TextStyle(fontWeight: FontWeight.w600)),
              Text('${l.item.code} • ${l.item.unit}${_needsFrom ? ' • المتاح ${fmt(_avail[l.item.id] ?? 0)}' : ''}', style: const TextStyle(fontSize: 12, color: Color(0xFF5D6877))),
              if (over) const Text('أكبر من المتاح', style: TextStyle(color: Color(0xFFAD3320), fontWeight: FontWeight.w600)),
            ]),
          ),
          SizedBox(
            width: 90,
            child: TextField(
              controller: l.qty,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              textAlign: TextAlign.center,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(errorText: null, enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: over ? const Color(0xFFAD3320) : Colors.grey))),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close),
            tooltip: 'حذف',
            onPressed: () => setState(() {
              _lines.removeAt(i).qty.dispose();
            }),
          ),
        ]),
      ),
    );
  }
}
