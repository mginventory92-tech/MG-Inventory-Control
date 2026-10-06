import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import 'common.dart';

class BalancesTab extends StatefulWidget {
  const BalancesTab({super.key});
  @override
  State<BalancesTab> createState() => _BalancesTabState();
}

class _BalancesTabState extends State<BalancesTab> {
  final _search = TextEditingController();
  Timer? _debounce;
  String? _warehouseId;
  bool _lowOnly = false;
  List<Map<String, dynamic>> _warehouses = [];
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final d = await Api.I.get('/stock/balances${Api.query({'q': _search.text.trim(), 'warehouseId': _warehouseId, 'lowOnly': _lowOnly ? 'true' : null})}');
      if (!mounted) return;
      setState(() {
        _warehouses = (d['warehouses'] as List).cast<Map<String, dynamic>>();
        _rows = (d['rows'] as List).cast<Map<String, dynamic>>();
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), _load);
  }

  Future<void> _scan() async {
    final code = await scanBarcode(context);
    if (code != null) {
      _search.text = code;
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
        child: Column(children: [
          TextField(
            controller: _search,
            onChanged: _onChanged,
            decoration: InputDecoration(
              hintText: 'بحث بالاسم أو الكود أو الباركود',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: IconButton(icon: const Icon(Icons.qr_code_scanner), tooltip: 'مسح باركود', onPressed: _scan),
            ),
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: DropdownButtonFormField<String?>(
                value: _warehouseId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'المخزن'),
                items: [
                  const DropdownMenuItem<String?>(value: null, child: Text('كل المخازن')),
                  for (final w in _warehouses) DropdownMenuItem<String?>(value: w['id'] as String, child: Text(w['name'] as String)),
                ],
                onChanged: (v) {
                  setState(() => _warehouseId = v);
                  _load();
                },
              ),
            ),
            const SizedBox(width: 8),
            FilterChip(
              label: const Text('تحت الحد'),
              selected: _lowOnly,
              onSelected: (v) {
                setState(() => _lowOnly = v);
                _load();
              },
            ),
          ]),
        ]),
      ),
      Expanded(child: _body()),
    ]);
  }

  Widget _body() {
    if (_error != null) return ErrorView(message: _error!, onRetry: _load);
    if (_loading && _rows.isEmpty) return const Center(child: CircularProgressIndicator());
    if (_rows.isEmpty) return const Center(child: Text('لا توجد أرصدة مطابقة.'));
    final cols = _warehouseId == null ? _warehouses : _warehouses.where((w) => w['id'] == _warehouseId).toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: _rows.length,
        itemBuilder: (_, i) {
          final r = _rows[i];
          final item = Map<String, dynamic>.from(r['item'] as Map);
          final qty = toD(r['qty']);
          final low = r['low'] == true;
          final color = qty <= 0 && toD(item['minQty']) > 0 ? const Color(0xFFAD3320) : low ? const Color(0xFFB87900) : const Color(0xFF2B7A4B);
          final per = Map<String, dynamic>.from(r['perWarehouse'] as Map);
          return Card(
            child: Container(
              decoration: BoxDecoration(border: BorderDirectional(start: BorderSide(color: low ? color : Colors.transparent, width: 4))),
              child: ListTile(
                title: Text(item['name'] as String),
                subtitle: Text([
                  item['code'],
                  if (cols.length > 1 || _warehouseId == null)
                    for (final w in cols) if (toD(per[w['id']]) != 0) '${w['name']}: ${fmt(toD(per[w['id']]))}',
                ].join(' • ')),
                trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                  Text(fmt(qty), style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: color)),
                  Text(item['unit'] as String, style: const TextStyle(fontSize: 12)),
                ]),
              ),
            ),
          );
        },
      ),
    );
  }
}
