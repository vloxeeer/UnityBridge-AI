using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace UnityBridgeAI
{
    /// <summary>
    /// Клиент моста UnityBridge AI. Подключается к ws://127.0.0.1:17777/ws,
    /// получает токен через локальный HTTP-эндпоинт и принимает запросы от браузерного расширения.
    /// </summary>
    public class UnityBridgeClient : IDisposable
    {
        public const string DefaultHttpUrl = "http://127.0.0.1:17777";
        public const string DefaultWsUrl = "ws://127.0.0.1:17777/ws";

        public event Action<BridgePrompt> OnPrompt;
        public event Action<bool, string> OnConnectionChanged;

        private ClientWebSocket _ws;
        private CancellationTokenSource _cts;
        private Task _receiveTask;
        private string _token;
        private bool _disposed;

        public bool IsConnected => _ws != null && _ws.State == WebSocketState.Open;

        public async Task<bool> ConnectAsync(string httpUrl = DefaultHttpUrl, string wsUrl = DefaultWsUrl)
        {
            try
            {
                _token = await FetchTokenAsync(httpUrl);
                _ws = new ClientWebSocket();
                _cts = new CancellationTokenSource();
                await _ws.ConnectAsync(new Uri(wsUrl), _cts.Token);
                await SendJsonAsync(new { type = "hello", source = "unity", token = _token, unityVersion = Application.unityVersion, project = Application.productName });
                _receiveTask = ReceiveLoopAsync(_cts.Token);
                OnConnectionChanged?.Invoke(true, "Подключено к мосту");
                return true;
            }
            catch (Exception e)
            {
                Debug.LogWarning("[UnityBridgeAI] Не удалось подключиться: " + e.Message);
                OnConnectionChanged?.Invoke(false, e.Message);
                return false;
            }
        }

        private static async Task<string> FetchTokenAsync(string httpUrl)
        {
            using (var req = UnityWebRequest.Get(httpUrl + "/token"))
            {
                var op = req.SendWebRequest();
                while (!op.isDone) await Task.Yield();
                if (req.result != UnityWebRequest.Result.Success)
                    throw new Exception("HTTP " + req.responseCode);
                var json = req.downloadHandler.text;
                // минимальный разбор: "token":"..."
                int i = json.IndexOf("\"token\"", StringComparison.Ordinal);
                if (i < 0) throw new Exception("Токен не найден в ответе моста");
                int a = json.IndexOf('"', json.IndexOf(':', i) + 1) + 1;
                int b = json.IndexOf('"', a);
                return json.Substring(a, b - a);
            }
        }

        private async Task ReceiveLoopAsync(CancellationToken ct)
        {
            var buffer = new byte[64 * 1024];
            try
            {
                while (!ct.IsCancellationRequested && _ws.State == WebSocketState.Open)
                {
                    var sb = new StringBuilder();
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                        if (result.MessageType == WebSocketMessageType.Close) break;
                        sb.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                    } while (!result.EndOfMessage);

                    if (result.MessageType == WebSocketMessageType.Close) break;
                    HandleJson(sb.ToString());
                }
            }
            catch (Exception e)
            {
                if (!ct.IsCancellationRequested)
                    Debug.LogWarning("[UnityBridgeAI] Соединение потеряно: " + e.Message);
            }
            finally
            {
                OnConnectionChanged?.Invoke(false, "Отключено");
            }
        }

        private void HandleJson(string json)
        {
            // достаём type
            string type = Extract(json, "type");
            if (type == "prompt")
            {
                var p = new BridgePrompt
                {
                    Id = Extract(json, "id"),
                    Site = Extract(json, "site"),
                    Url = Extract(json, "url"),
                    Text = Extract(json, "text"),
                    Prompt = Extract(json, "prompt"),
                    Mode = Extract(json, "mode")
                };
                OnPrompt?.Invoke(p);
            }
        }

        private static string Extract(string json, string key)
        {
            int i = json.IndexOf("\"" + key + "\"", StringComparison.Ordinal);
            if (i < 0) return "";
            int c = json.IndexOf(':', i);
            if (c < 0) return "";
            int a = json.IndexOf('"', c + 1);
            if (a < 0) return "";
            int b = json.IndexOf('"', a + 1);
            if (b < 0) return "";
            return json.Substring(a + 1, b - a - 1).Replace("\\n", "\n").Replace("\\\"", "\"");
        }

        public async Task SendResponseAsync(string id, bool ok, string result, string error = "")
        {
            await SendJsonAsync("{\"type\":\"response\",\"id\":\"" + Esc(id) + "\",\"ok\":" + (ok ? "true" : "false") +
                ",\"result\":\"" + Esc(result) + "\",\"error\":\"" + Esc(error) + "\"}");
        }

        private async Task SendJsonAsync(string json)
        {
            if (!IsConnected) return;
            var bytes = Encoding.UTF8.GetBytes(json);
            await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _cts.Token);
        }

        private static string Esc(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            try { _cts?.Cancel(); } catch { }
            try { _ws?.Dispose(); } catch { }
        }
    }

    public class BridgePrompt
    {
        public string Id;
        public string Site;
        public string Url;
        public string Text;
        public string Prompt;
        public string Mode;
    }
}
