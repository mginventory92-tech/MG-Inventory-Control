import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../models.dart';
import 'common.dart';

class ItemsTab extends StatefulWidget {
  const ItemsTab({super.key});
  @override
  State<ItemsTab> createState() => _ItemsTabState();
}

class _ItemsTabState extends State<ItemsTab> {
  final _search = TextEditingController();
  Timer? _debounce;
  List<Item> _items = [];
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
      final d = await Api.I.get('/items${Api.query({'q': _search.text.trim()})}');
      if (mounted) setState(() => _items = (d as List).map((e) => Item.fromJson(Map<String, dynamic>.from(e as Map))).toList());
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _scan() async {
    final code = await scanBarcode(context);
    if (code != null) {
      _search.text = code;
      _load();
    }
  }

  Future<void> _edit([Item? item]) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ItemForm(item: item),
    );
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final manage = Api.I.can('items');
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: manage ? FloatingActionButton.extended(onPressed: () => _edit(), icon: const Icon(Icons.add), label: const Text('صنف جديد')) : null,
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            controller: _search,
            onChanged: (_) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 350), _load);
            },
            decoration: InputDecoration(
              hintText: 'بحث بالاسم أو الكود أو الباركود',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: IconButton(icon: const Icon(Icons.qr_code_scanner), tooltip: 'مسح باركود', onPressed: _scan),
            ),
          ),
        ),
        Expanded(
          child: _error != null
              ? ErrorView(message: _error!, onRetry: _load)
              : _loading && _items.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : _items.isEmpty
                      ? const Center(child: Text('لا توجد أصناف مطابقة.'))
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView.builder(
                            padding: const EdgeInsets.fromLTRB(12, 0, 12, 90),
                            itemCount: _items.length,
                            itemBuilder: (_, i) {
                              final it = _items[i];
                              return Card(
                                child: ListTile(
                                  title: Text(it.name),
                                  subtitle: Text([it.code, if (it.category != null) it.category!, if (it.barcode != null) it.barcode!].join(' • ')),
                                  trailing: Text(it.unit),
                                  onTap: manage ? () => _edit(it) : null,
                                ),
                              );
                            },
                          ),
                        ),
        ),
      ]),
    );
  }
}

class _ItemForm extends StatefulWidget {
  final Item? item;
  const _ItemForm({this.item});
  @override
  State<_ItemForm> createState() => _ItemFormState();
}

class _ItemFormState extends State<_ItemForm> {
  late final _name = TextEditingController(text: widget.item?.name ?? '');
  late final _barcode = TextEditingController(text: widget.item?.barcode ?? '');
  late final _category = TextEditingController(text: widget.item?.category ?? '');
  late final _unit = TextEditingController(text: widget.item?.unit ?? 'قطعة');
  late final _min = TextEditingController(text: fmt(widget.item?.minQty ?? 0));
  bool _busy = false;
  String? _error;

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'اسم الصنف مطلوب');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final body = {
      'name': _name.text.trim(),
      'barcode': _barcode.text.trim(),
      'category': _category.text.trim(),
      'unit': _unit.text.trim(),
      'minQty': double.tryParse(_min.text.trim()) ?? 0,
    };
    try {
      if (widget.item == null) {
        await Api.I.post('/items', body);
      } else {
        await Api.I.patch('/items/${widget.item!.id}', body);
      }
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(widget.item == null ? 'إضافة صنف' : 'تعديل صنف', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: Text(_error!, style: const TextStyle(color: Color(0xFFAD3320)))),
            TextField(controller: _name, decoration: const InputDecoration(labelText: 'اسم الصنف')),
            const SizedBox(height: 10),
            TextField(
              controller: _barcode,
              decoration: InputDecoration(
                labelText: 'الباركود',
                suffixIcon: IconButton(
                  icon: const Icon(Icons.qr_code_scanner),
                  onPressed: () async {
                    final c = await scanBarcode(context);
                    if (c != null) _barcode.text = c;
                  },
                ),
              ),
            ),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: TextField(controller: _category, decoration: const InputDecoration(labelText: 'التصنيف'))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: _unit, decoration: const InputDecoration(labelText: 'الوحدة'))),
            ]),
            const SizedBox(height: 10),
            TextField(
              controller: _min,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'الحد الأدنى للمخزون', helperText: 'يظهر تنبيه عند الوصول له. 0 يلغي التنبيه.'),
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'جاري الحفظ…' : 'حفظ')),
          ]),
        ),
      );
}
