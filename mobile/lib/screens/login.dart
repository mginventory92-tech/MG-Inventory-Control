import 'package:flutter/material.dart';

import '../api.dart';

class LoginScreen extends StatefulWidget {
  final VoidCallback onLoggedIn;
  final String? initialMessage;
  const LoginScreen({super.key, required this.onLoggedIn, this.initialMessage});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _user = TextEditingController();
  final _pass = TextEditingController();
  late final TextEditingController _server = TextEditingController(text: Api.I.baseUrl);
  bool _busy = false;
  String? _error;
  bool _showServer = false;

  @override
  void initState() {
    super.initState();
    _error = widget.initialMessage;
    _showServer = widget.initialMessage != null;
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Api.I.setBaseUrl(_server.text);
      await Api.I.login(_user.text.trim().toLowerCase(), _pass.text);
      widget.onLoggedIn();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFF1B2430),
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text('نظام المخازن', style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.start),
                    const SizedBox(height: 4),
                    const Text('سجّل الدخول للمتابعة'),
                    const SizedBox(height: 18),
                    if (_error != null)
                      Container(
                        padding: const EdgeInsets.all(10),
                        margin: const EdgeInsets.only(bottom: 12),
                        color: const Color(0xFFFBE7E2),
                        child: Text(_error!, style: const TextStyle(color: Color(0xFFAD3320))),
                      ),
                    TextField(
                      controller: _user,
                      decoration: const InputDecoration(labelText: 'اسم المستخدم'),
                      autocorrect: false,
                      textInputAction: TextInputAction.next,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _pass,
                      decoration: const InputDecoration(labelText: 'كلمة المرور'),
                      obscureText: true,
                      onSubmitted: (_) => _submit(),
                    ),
                    if (_showServer) ...[
                      const SizedBox(height: 12),
                      TextField(
                        controller: _server,
                        decoration: const InputDecoration(labelText: 'عنوان السيرفر', helperText: 'مثال: https://inventory.example.com/api'),
                        keyboardType: TextInputType.url,
                        textDirection: TextDirection.ltr,
                      ),
                    ],
                    const SizedBox(height: 18),
                    FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'جاري الدخول…' : 'دخول')),
                    TextButton(
                      onPressed: () => setState(() => _showServer = !_showServer),
                      child: Text(_showServer ? 'إخفاء إعدادات السيرفر' : 'إعدادات السيرفر'),
                    ),
                  ]),
                ),
              ),
            ),
          ),
        ),
      );
}

