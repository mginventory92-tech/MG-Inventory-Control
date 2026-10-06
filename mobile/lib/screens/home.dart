import 'package:flutter/material.dart';

import '../api.dart';
import 'balances.dart';
import 'common.dart';
import 'documents.dart';
import 'items.dart';
import 'new_document.dart';

class HomeShell extends StatefulWidget {
  final VoidCallback onLogout;
  const HomeShell({super.key, required this.onLogout});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _Tab {
  final String label;
  final IconData icon;
  final Widget Function() build;
  _Tab(this.label, this.icon, this.build);
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  List<_Tab> get _tabs => [
        _Tab('الرئيسية', Icons.home_outlined, () => DashboardTab(onLogout: widget.onLogout)),
        _Tab('الأرصدة', Icons.inventory_2_outlined, () => const BalancesTab()),
        _Tab('الأصناف', Icons.category_outlined, () => const ItemsTab()),
        if (Api.I.canAny(['reports', 'in', 'out', 'transfer']))
          _Tab('الإذون', Icons.receipt_long_outlined, () => const DocumentsTab()),
      ];

  @override
  Widget build(BuildContext context) {
    final tabs = _tabs;
    final i = _index.clamp(0, tabs.length - 1);
    return Scaffold(
      appBar: brandedAppBar(Text(tabs[i].label)),
      body: tabs[i].build(),
      bottomNavigationBar: NavigationBar(
        selectedIndex: i,
        onDestinationSelected: (v) => setState(() => _index = v),
        destinations: [for (final t in tabs) NavigationDestination(icon: Icon(t.icon), label: t.label)],
      ),
    );
  }
}

class DashboardTab extends StatefulWidget {
  final VoidCallback onLogout;
  const DashboardTab({super.key, required this.onLogout});
  @override
  State<DashboardTab> createState() => _DashboardTabState();
}

class _DashboardTabState extends State<DashboardTab> {
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final d = await Api.I.get('/dashboard');
      if (mounted) setState(() => _data = Map<String, dynamic>.from(d as Map));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _open(String type) async {
    final created = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => NewDocumentScreen(type: type)));
    if (created == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null && _data == null) return ErrorView(message: _error!, onRetry: _load);
    final d = _data;
    if (d == null) return const Center(child: CircularProgressIndicator());
    final counts = Map<String, dynamic>.from(d['counts'] as Map);
    final low = (d['low'] as List).cast<Map<String, dynamic>>();
    final lowCount = d['lowCount'] as int;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(16), children: [
        Text('أهلاً ${Api.I.user?['name'] ?? ''}', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 14),
        Wrap(spacing: 8, runSpacing: 8, children: [
          if (Api.I.can('in')) FilledButton.icon(onPressed: () => _open('in'), icon: const Icon(Icons.add), label: const Text('إذن إضافة')),
          if (Api.I.can('out')) FilledButton.icon(onPressed: () => _open('out'), icon: const Icon(Icons.remove), label: const Text('إذن صرف')),
          if (Api.I.can('transfer')) FilledButton.icon(onPressed: () => _open('transfer'), icon: const Icon(Icons.swap_horiz), label: const Text('تحويل')),
        ]),
        const SizedBox(height: 16),
        Row(children: [
          _Stat(value: '$lowCount', label: 'تحت الحد الأدنى', warn: lowCount > 0),
          const SizedBox(width: 8),
          _Stat(value: '${counts['items']}', label: 'صنف'),
          const SizedBox(width: 8),
          _Stat(value: '${counts['docsToday']}', label: 'إذن اليوم'),
        ]),
        const SizedBox(height: 18),
        Text('أصناف تحتاج توريد', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 6),
        if (low.isEmpty)
          const Padding(padding: EdgeInsets.all(12), child: Text('كل الأصناف فوق الحد الأدنى.'))
        else
          for (final r in low)
            Card(
              child: ListTile(
                title: Text(r['item']['name'] as String),
                subtitle: Text('${r['item']['code']} • الحد الأدنى ${fmt(toD(r['item']['minQty']))}'),
                trailing: Text('${fmt(toD(r['total']))} ${r['item']['unit']}',
                    style: TextStyle(fontWeight: FontWeight.bold, color: toD(r['total']) <= 0 ? const Color(0xFFAD3320) : const Color(0xFFB87900))),
              ),
            ),
        const SizedBox(height: 18),
        OutlinedButton(onPressed: widget.onLogout, child: const Text('تسجيل الخروج')),
      ]),
    );
  }
}

class _Stat extends StatelessWidget {
  final String value;
  final String label;
  final bool warn;
  const _Stat({required this.value, required this.label, this.warn = false});
  @override
  Widget build(BuildContext context) => Expanded(
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: warn ? const Color(0xFFFBF1D9) : Colors.white,
            border: Border.all(color: warn ? const Color(0xFFB87900) : const Color(0xFFD8DCD4)),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(value, style: TextStyle(fontSize: 26, fontWeight: FontWeight.w600, color: warn ? const Color(0xFFB87900) : null)),
            Text(label, style: const TextStyle(fontSize: 12, color: Color(0xFF5D6877))),
          ]),
        ),
      );
}

