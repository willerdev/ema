//+------------------------------------------------------------------+
//|  EMA MT5 EA sample — telemetry + command poll + ack              |
//|  Copy into MetaEditor, set inputs, compile on chart.           |
//|  Enable: Tools → Options → Expert Advisors →                    |
//|  "Allow WebRequest for listed URL" → add your ApiBase host only |
//+------------------------------------------------------------------+
#property copyright "EMA"
#property link      ""
#property version   "1.00"

input string ApiBase        = "https://your-backend.onrender.com"; // no trailing slash
input string EaBearerToken  = ""; // from POST /mt5/accounts/:id/ea-webhook-token (JWT app session)
input int    TelemetrySec   = 15;
input int    PollCommandsSec= 5;

datetime lastTelemetry = 0;
datetime lastPoll      = 0;

string JsonEscape(string s) {
  string r = s;
  StringReplace(r, "\\", "\\\\");
  StringReplace(r, "\"", "\\\"");
  return r;
}

bool PostTelemetry() {
  if(StringLen(EaBearerToken) < 8) return false;
  string login = (string)AccountInfoInteger(ACCOUNT_LOGIN);
  string server = AccountInfoString(ACCOUNT_SERVER);
  double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
  double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
  string body = "{";
  body += "\"login\":\"" + JsonEscape(login) + "\",";
  body += "\"server\":\"" + JsonEscape(server) + "\",";
  body += "\"symbol\":\"" + JsonEscape(_Symbol) + "\",";
  body += "\"bid\":" + DoubleToString(bid, (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS)) + ",";
  body += "\"ask\":" + DoubleToString(ask, (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS)) + ",";
  body += "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2);
  body += "}";
  char data[];
  int sz = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
  if(sz < 1) return false;
  string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + EaBearerToken + "\r\n";
  char result[];
  string result_headers;
  ResetLastError();
  int status = WebRequest("POST", ApiBase + "/webhooks/mt5-ea/telemetry", headers, 8000, data, sz, result, result_headers);
  if(status == -1) {
    Print("WebRequest telemetry failed. err=", GetLastError(), " — add URL to allowed list and use HTTPS.");
    return false;
  }
  Print("telemetry HTTP ", status);
  return (status >= 200 && status < 300);
}

bool PollAndAckCommands() {
  if(StringLen(EaBearerToken) < 8) return false;
  string headers = "Authorization: Bearer " + EaBearerToken + "\r\n";
  char post[];
  char result[];
  string result_headers;
  ResetLastError();
  int status = WebRequest("GET", ApiBase + "/webhooks/mt5-ea/commands", headers, 8000, post, 0, result, result_headers);
  if(status == -1) {
    Print("WebRequest commands failed. err=", GetLastError());
    return false;
  }
  string json = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
  // Minimal demo: if response contains "commands" and an id, log only.
  // Production: parse JSON (use JAson library or string splits), then OrderSend, then POST ack.
  if(StringFind(json, "\"commands\"") >= 0)
    Print("commands payload (trunc): ", StringSubstr(json, 0, 500));
  return true;
}

int OnInit() {
  if(StringFind(ApiBase, "https://") != 0) {
    Print("ApiBase must start with https://");
    return INIT_PARAMETERS_INCORRECT;
  }
  return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {}

void OnTick() {
  datetime now = TimeCurrent();
  if(now - lastTelemetry >= TelemetrySec) {
    lastTelemetry = now;
    PostTelemetry();
  }
  if(now - lastPoll >= PollCommandsSec) {
    lastPoll = now;
    PollAndAckCommands();
  }
}

//+------------------------------------------------------------------+
