import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Dark app bar used on every screen (set per screen instead of via ThemeData so it works across Flutter versions).
AppBar brandedAppBar(Widget title) =>
    AppBar(title: title, backgroundColor: const Color(0xFF1B2430), foregroundColor: Colors.white);

void snack(BuildContext context, String msg, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? const Color(0xFFAD3320) : null,
      duration: Duration(seconds: error ? 6 : 3),
    ));
}

class ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const ErrorView({super.key, required this.message, required this.onRetry});
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFFAD3320))),
            const SizedBox(height: 12),
            FilledButton(onPressed: onRetry, child: const Text('إعادة المحاولة')),
          ]),
        ),
      );
}

/// Opens the camera and pops with the first barcode it reads (or null if cancelled).
class ScannerScreen extends StatefulWidget {
  const ScannerScreen({super.key});
  @override
  State<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends State<ScannerScreen> {
  bool _done = false;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: brandedAppBar(const Text('مسح باركود')),
        body: MobileScanner(
          onDetect: (capture) {
            if (_done) return;
            for (final b in capture.barcodes) {
              final v = b.rawValue;
              if (v != null && v.isNotEmpty) {
                _done = true;
                Navigator.of(context).pop(v);
                return;
              }
            }
          },
        ),
      );
}

Future<String?> scanBarcode(BuildContext context) =>
    Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScannerScreen()));
