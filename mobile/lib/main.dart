import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'api.dart';
import 'screens/home.dart';
import 'screens/login.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Api.I.load();
  runApp(const InventoryApp());
}

class InventoryApp extends StatefulWidget {
  const InventoryApp({super.key});
  @override
  State<InventoryApp> createState() => _InventoryAppState();
}

class _InventoryAppState extends State<InventoryApp> {
  bool _checking = true;
  bool _loggedIn = false;
  String? _startError;

  @override
  void initState() {
    super.initState();
    Api.I.onUnauthorized = () {
      if (mounted) setState(() => _loggedIn = false);
    };
    _restore();
  }

  Future<void> _restore() async {
    try {
      final ok = await Api.I.restoreSession();
      if (mounted) setState(() => _loggedIn = ok);
    } on ApiException catch (e) {
      if (mounted) setState(() => _startError = e.message);
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF0E4A5A);
    Widget home;
    if (_checking) {
      home = const Scaffold(body: Center(child: CircularProgressIndicator()));
    } else if (_loggedIn) {
      home = HomeShell(onLogout: () async {
        await Api.I.logout();
        if (mounted) setState(() => _loggedIn = false);
      });
    } else {
      home = LoginScreen(
        initialMessage: _startError,
        onLoggedIn: () => setState(() => _loggedIn = true),
      );
    }
    return MaterialApp(
      title: 'نظام المخازن',
      debugShowCheckedModeBanner: false,
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: seed),
        scaffoldBackgroundColor: const Color(0xFFF1F2EE),
      ),
      home: home,
    );
  }
}
