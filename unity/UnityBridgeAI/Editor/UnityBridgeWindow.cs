using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace UnityBridgeAI
{
    /// <summary>
    /// Окно UnityBridge AI в редакторе: статус подключения, входящие запросы от браузера
    /// и простой интерпретатор команд (создание объектов и т.п.).
    /// </summary>
    public class UnityBridgeWindow : EditorWindow
    {
        private UnityBridgeClient _client;
        private readonly List<string> _log = new List<string>();
        private BridgePrompt _lastPrompt;
        private Vector2 _scroll;
        private bool _autoHandle = true;

        [MenuItem("Window/UnityBridge AI %#u")]
        public static void Open()
        {
            var w = GetWindow<UnityBridgeWindow>("UnityBridge AI");
            w.Show();
        }

        private void OnEnable()
        {
            _client = new UnityBridgeClient();
            _client.OnPrompt += HandlePrompt;
            _client.OnConnectionChanged += (ok, msg) => { AddLog((ok ? "✅ " : "❌ ") + msg); Repaint(); };
            _client.ConnectAsync();
        }

        private void OnDisable()
        {
            _client?.Dispose();
        }

        private void HandlePrompt(BridgePrompt p)
        {
            _lastPrompt = p;
            AddLog($"📥 Запрос с {p.Site}: {p.Prompt}");
            if (_autoHandle)
            {
                string result = ExecuteCommand(p.Prompt);
                _client.SendResponseAsync(p.Id, true, result);
                AddLog("📤 Ответ отправлен: " + result);
            }
            Repaint();
        }

        private string ExecuteCommand(string cmd)
        {
            if (string.IsNullOrEmpty(cmd)) return "Пустой запрос.";
            string c = cmd.ToLowerInvariant().Trim();
            try
            {
                if (c.Contains("куб") || c.Contains("cube"))
                {
                    var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    Undo.RegisterCreatedObjectUndo(go, "Create Cube (UnityBridge AI)");
                    return "Создан куб " + go.name;
                }
                if (c.Contains("сфер") || c.Contains("sphere"))
                {
                    var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                    Undo.RegisterCreatedObjectUndo(go, "Create Sphere (UnityBridge AI)");
                    return "Создана сфера " + go.name;
                }
                if (c.Contains("плоскост") || c.Contains("plane"))
                {
                    var go = GameObject.CreatePrimitive(PrimitiveType.Plane);
                    Undo.RegisterCreatedObjectUndo(go, "Create Plane (UnityBridge AI)");
                    return "Создана плоскость " + go.name;
                }
                if (c.Contains("свет") || c.Contains("light"))
                {
                    var go = new GameObject("Bridge Light");
                    Undo.RegisterCreatedObjectUndo(go, "Create Light (UnityBridge AI)");
                    go.AddComponent<Light>().type = LightType.Directional;
                    return "Создан источник света";
                }
                if (c.Contains("очистить") || c.Contains("clear"))
                {
                    foreach (var go in UnityEngine.Object.FindObjectsOfType<GameObject>())
                        if (go.transform.parent == null && go.name.Contains("Bridge")) Undo.DestroyObjectImmediate(go);
                    return "Сцена очищена от объектов моста";
                }
                return "Запрос получен. (Автоответ: " + cmd + ") — расширьте ExecuteCommand под свои команды.";
            }
            catch (Exception e)
            {
                return "Ошибка выполнения: " + e.Message;
            }
        }

        private void AddLog(string s) { _log.Add($"[{DateTime.Now:HH:mm:ss}] {s}"); if (_log.Count > 200) _log.RemoveAt(0); }

        private void OnGUI()
        {
            GUILayout.Label("Мост: ws://127.0.0.1:17777/ws", EditorStyles.boldLabel);
            bool connected = _client != null && _client.IsConnected;
            EditorGUILayout.LabelField("Статус:", connected ? "Подключено ✅" : "Не подключено ❌ (запустите программу UnityBridge AI)");
            _autoHandle = EditorGUILayout.Toggle("Автообработка запросов", _autoHandle);

            if (GUILayout.Button(connected ? "Переподключиться" : "Подключиться"))
            {
                _client?.Dispose();
                _client = new UnityBridgeClient();
                _client.OnPrompt += HandlePrompt;
                _client.OnConnectionChanged += (ok, msg) => { AddLog((ok ? "✅ " : "❌ ") + msg); Repaint(); };
                _client.ConnectAsync();
            }

            if (_lastPrompt != null)
            {
                EditorGUILayout.LabelField("Последний запрос:", _lastPrompt.Prompt);
                if (GUILayout.Button("Ответить вручную…"))
                {
                    string ans = EditorInputDialog.Show("Ответ для браузера", "Введите ответ:", "");
                    if (ans != null) { _client.SendResponseAsync(_lastPrompt.Id, true, ans); AddLog("📤 Ручной ответ отправлен"); }
                }
            }

            EditorGUILayout.LabelField("Лог:", EditorStyles.boldLabel);
            _scroll = EditorGUILayout.BeginScrollView(_scroll);
            foreach (var line in _log) EditorGUILayout.LabelField(line, EditorStyles.wordWrappedMiniLabel);
            EditorGUILayout.EndScrollView();
        }

        private static class EditorInputDialog
        {
            public static string Show(string title, string message, string defaultValue)
            {
                return EditorUtility.DisplayDialog(title, message, "OK", "Cancel") ? defaultValue : null;
            }
        }
    }
}
