import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);
  @override
  String toString() => message;
}

/// Single place that talks to the NestJS API.
class Api {
  Api._();
  static final Api I = Api._();

  /// 10.0.2.2 is the host machine as seen from the Android emulator.
  String baseUrl = 'http://10.0.2.2:3000/api';
  String? token;
  Map<String, dynamic>? user;
  void Function()? onUnauthorized;

  Future<void> load() async {
    final p = await SharedPreferences.getInstance();
    baseUrl = p.getString('baseUrl') ?? baseUrl;
    token = p.getString('token');
  }

  Future<void> setBaseUrl(String url) async {
    var u = url.trim();
    while (u.endsWith('/')) {
      u = u.substring(0, u.length - 1);
    }
    baseUrl = u;
    final p = await SharedPreferences.getInstance();
    await p.setString('baseUrl', u);
  }

  Future<void> _saveToken(String? t) async {
    token = t;
    final p = await SharedPreferences.getInstance();
    if (t == null) {
      await p.remove('token');
    } else {
      await p.setString('token', t);
    }
  }

  bool can(String perm) {
    final list = user?['permissions'];
    return list is List && list.contains(perm);
  }

  bool canAny(List<String> perms) => perms.any(can);

  Future<void> login(String username, String password) async {
    final r = await post('/auth/login', {'username': username, 'password': password});
    await _saveToken(r['token'] as String);
    user = Map<String, dynamic>.from(r['user'] as Map);
  }

  /// Returns false when the saved session is no longer valid.
  Future<bool> restoreSession() async {
    if (token == null) return false;
    try {
      user = Map<String, dynamic>.from(await get('/auth/me') as Map);
      return true;
    } on ApiException catch (e) {
      if (e.status == 0) rethrow; // offline: keep the token, let the caller show the error
      await logout();
      return false;
    }
  }

  Future<void> logout() async {
    user = null;
    await _saveToken(null);
  }

  static String query(Map<String, Object?> params) {
    final parts = <String>[];
    params.forEach((k, v) {
      if (v == null || v.toString().isEmpty) return;
      parts.add('${Uri.encodeQueryComponent(k)}=${Uri.encodeQueryComponent(v.toString())}');
    });
    return parts.isEmpty ? '' : '?${parts.join('&')}';
  }

  Future<dynamic> get(String path) => _send('GET', path);
  Future<dynamic> post(String path, [Object? body]) => _send('POST', path, body ?? {});
  Future<dynamic> patch(String path, [Object? body]) => _send('PATCH', path, body ?? {});

  Future<dynamic> _send(String method, String path, [Object? body]) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = <String, String>{
      'content-type': 'application/json',
      if (token != null) 'authorization': 'Bearer $token',
    };
    http.Response res;
    try {
      final timeout = const Duration(seconds: 20);
      switch (method) {
        case 'POST':
          res = await http.post(uri, headers: headers, body: jsonEncode(body)).timeout(timeout);
          break;
        case 'PATCH':
          res = await http.patch(uri, headers: headers, body: jsonEncode(body)).timeout(timeout);
          break;
        default:
          res = await http.get(uri, headers: headers).timeout(timeout);
      }
    } on Exception {
      throw ApiException(0, 'تعذّر الاتصال بالسيرفر. تأكد من الإنترنت ومن عنوان السيرفر.');
    }
    dynamic data;
    try {
      data = res.bodyBytes.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      data = null;
    }
    if (res.statusCode >= 400) {
      if (res.statusCode == 401 && path != '/auth/login') {
        await logout();
        onUnauthorized?.call();
      }
      var msg = 'حدث خطأ غير متوقع';
      if (data is Map && data['message'] != null) {
        final m = data['message'];
        msg = m is List ? m.join('، ') : m.toString();
      }
      throw ApiException(res.statusCode, msg);
    }
    return data;
  }
}

/// Formats a quantity without trailing zeros (12.0 -> 12, 1.5 -> 1.5).
String fmt(num? n) {
  if (n == null) return '';
  if (n == n.roundToDouble()) return n.toInt().toString();
  var s = n.toStringAsFixed(3);
  while (s.endsWith('0')) {
    s = s.substring(0, s.length - 1);
  }
  return s;
}

double toD(dynamic v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
