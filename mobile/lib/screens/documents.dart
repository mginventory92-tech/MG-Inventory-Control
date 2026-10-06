import 'package:flutter/material.dart';

import '../api.dart';
import '../models.dart';
import 'common.dart';

class DocumentsTab extends StatefulWidget {
  const DocumentsTab({super.key});
  @override
  State<DocumentsTab> createState() => _DocumentsTabState();
}

class _DocumentsTabState extends State<DocumentsTab> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String? _type;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final d = await Api.I.get('/documents${Api.query({'type': _type, 'limit': 100})}');
      if (mounted) setState(() => _rows = (d['rows'] as List).cast<Map<String, dynamic>>());
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Wrap(spacing: 8, children: [
            ChoiceChip(label: const Text('الكل'), selected: _type == null, onSelected: (_) { setState(() => _type = null); _load(); }),
            for (final e in docLabels.entries)
              ChoiceChip(label: Text(e.value), selected: _type == e.key, onSelected: (_) { setState(() => _type = e.key); _load(); }),
          ]),
        ),
        Expanded(
          child: _error != null
              ? ErrorView(message: _error!, onRetry: _load)
              : _loading && _rows.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : _rows.isEmpty
                      ? const Center(child: Text('لا توجد إذون.'))
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView.builder(
                            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                            itemCount: _rows.length,
                            itemBuilder: (_, i) {
                              final d = _rows[i];
                              final from = d['fromWarehouse']?['name'];
                              final to = d['toWarehouse']?['name'];
                              return Card(
                                child: ListTile(
                                  title: Text('${docLabels[d['type']]} ${d['number']}'),
                                  subtitle: Text([d['date'], [from, to].whereType<String>().join(' ← '), d['party']?['name']].where((x) => x != null && x.toString().isNotEmpty).join(' • ')),
                                  trailing: const Icon(Icons.chevron_left),
                                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => DocumentDetailScreen(id: d['id'] as String))),
                                ),
                              );
                            },
                          ),
                        ),
        ),
      ]);
}

class DocumentDetailScreen extends StatefulWidget {
  final String id;
  const DocumentDetailScreen({super.key, required this.id});
  @override
  State<DocumentDetailScreen> createState() => _DocumentDetailScreenState();
}

class _DocumentDetailScreenState extends State<DocumentDetailScreen> {
  Map<String, dynamic>? _doc;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final d = await Api.I.get('/documents/${widget.id}');
      if (mounted) setState(() => _doc = Map<String, dynamic>.from(d as Map));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _doc;
    return Scaffold(
      appBar: brandedAppBar(Text(d == null ? 'الإذن' : '${docLabels[d['type']]} ${d['number']}')),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _load)
          : d == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(padding: const EdgeInsets.all(16), children: [
                  _row('التاريخ', d['date']),
                  _row('من مخزن', d['fromWarehouse']?['name']),
                  _row('إلى مخزن', d['toWarehouse']?['name']),
                  _row(d['type'] == 'in' ? 'المورد' : 'العميل / الجهة', d['party']?['name']),
                  _row('المرجع', d['reference']),
                  _row('سجّله', d['createdBy']?['name']),
                  _row('ملاحظات', d['notes']),
                  const Divider(height: 28),
                  for (final l in (d['lines'] as List).cast<Map<String, dynamic>>())
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(l['item']['name'] as String),
                      subtitle: Text(l['item']['code'] as String),
                      trailing: Text('${fmt(toD(l['qty']))} ${l['item']['unit']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    ),
                ]),
    );
  }

  Widget _row(String label, dynamic value) {
    if (value == null || value.toString().isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 96, child: Text(label, style: const TextStyle(color: Color(0xFF5D6877)))),
        Expanded(child: Text(value.toString())),
      ]),
    );
  }
}
