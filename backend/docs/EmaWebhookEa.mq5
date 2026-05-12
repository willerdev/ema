//+------------------------------------------------------------------+
//|                                              EmaWebhookEa.mq5  |
//|                        EMA backend: telemetry + command queue   |
//+------------------------------------------------------------------+
#property copyright "EMA"
#property link      "https://github.com/willerdev/ema"
#property version   "1.01"
#property description "POSTs telemetry and polls GET /webhooks/mt5-ea/commands; executes market orders and POSTs ack."
#property strict

#include <Trade/Trade.mqh>

#define MAX_EA_COMMANDS 32

input string InpApiBase =
   "https://your-backend.onrender.com";   // No trailing slash; must be https
input string InpEaBearerToken =
   "";                                     // From POST /mt5/accounts/:id/ea-webhook-token (JWT session)
input int    InpTelemetrySeconds  = 15;   // POST telemetry interval
input int    InpPollSeconds       = 5;    // GET commands interval
input bool   InpExecuteCommands   = true; // If false: logs commands only, acks as failed with reason
input ulong  InpTradeDeviationPts = 30;   // max slippage (points)

struct EaCommand
{
   string id;
   string client_id;
   string side;
   string symbol;
   double volume;
   double stop_loss;
   double take_profit;
   long   magic;
   bool   has_sl;
   bool   has_tp;
};

CTrade g_trade;
datetime g_last_telemetry = 0;
datetime g_last_poll      = 0;

//+------------------------------------------------------------------+
string TrimApiBase(string base)
{
   string b = base;
   while(StringLen(b) > 0 && StringGetCharacter(b, StringLen(b) - 1) == '/')
      b = StringSubstr(b, 0, StringLen(b) - 1);
   return b;
}

//+------------------------------------------------------------------+
string JsonEscape(const string s)
{
   string r = s;
   StringReplace(r, "\\", "\\\\");
   StringReplace(r, "\"", "\\\"");
   StringReplace(r, "\r", "\\r");
   StringReplace(r, "\n", "\\n");
   return r;
}

//+------------------------------------------------------------------+
bool JsonGetString(const string json, const int from, const string key, string &out)
{
   string pat = "\"" + key + "\":\"";
   int p = StringFind(json, pat, from);
   if(p < 0)
   {
      out = "";
      return false;
   }
   p += StringLen(pat);
   int q = StringFind(json, "\"", p);
   if(q < 0)
   {
      out = "";
      return false;
   }
   out = StringSubstr(json, p, q - p);
   return true;
}

//+------------------------------------------------------------------+
bool JsonGetNumberAfterKey(const string json, const int from, const string key, double &out, bool &is_null)
{
   string pat = "\"" + key + "\":";
   int p = StringFind(json, pat, from);
   if(p < 0)
      return false;
   p += StringLen(pat);
   if(StringFind(json, "null", p) == p)
   {
      is_null = true;
      out = 0;
      return true;
   }
   is_null = false;
   int q = p;
   int len = StringLen(json);
   while(q < len)
   {
      int c = StringGetCharacter(json, q);
      if((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E')
      {
         q++;
         continue;
      }
      break;
   }
   if(q == p)
      return false;
   string num = StringSubstr(json, p, q - p);
   out = StringToDouble(num);
   return true;
}

//+------------------------------------------------------------------+
bool JsonGetLongAfterKey(const string json, const int from, const string key, long &out)
{
   string pat = "\"" + key + "\":";
   int p = StringFind(json, pat, from);
   if(p < 0)
      return false;
   p += StringLen(pat);
   int q = p;
   int len = StringLen(json);
   while(q < len)
   {
      int c = StringGetCharacter(json, q);
      if(c >= '0' && c <= '9')
      {
         q++;
         continue;
      }
      break;
   }
   if(q == p)
      return false;
   string num = StringSubstr(json, p, q - p);
   out = (long)StringToInteger(num);
   return true;
}

//+------------------------------------------------------------------+
bool ExtractBraceObject(const string json, const int ob, int &end_b)
{
   if(ob < 0 || ob >= StringLen(json) || StringGetCharacter(json, ob) != '{')
      return false;
   int depth = 0;
   int len = StringLen(json);
   for(int i = ob; i < len; i++)
   {
      int c = StringGetCharacter(json, i);
      if(c == '{')
         depth++;
      else if(c == '}')
      {
         depth--;
         if(depth == 0)
         {
            end_b = i;
            return true;
         }
      }
   }
   return false;
}

//+------------------------------------------------------------------+
bool FillCommandFromJsonObject(const string obj, EaCommand &cmd)
{
   if(!JsonGetString(obj, 0, "id", cmd.id) || StringLen(cmd.id) < 8)
      return false;
   JsonGetString(obj, 0, "clientId", cmd.client_id);
   JsonGetString(obj, 0, "side", cmd.side);
   JsonGetString(obj, 0, "symbol", cmd.symbol);
   bool vol_null = false;
   bool dn = false, tn = false;
   if(!JsonGetNumberAfterKey(obj, 0, "volume", cmd.volume, vol_null) || vol_null)
      return false;
   cmd.has_sl = JsonGetNumberAfterKey(obj, 0, "stopLoss", cmd.stop_loss, dn) && !dn;
   cmd.has_tp = JsonGetNumberAfterKey(obj, 0, "takeProfit", cmd.take_profit, tn) && !tn;
   if(!JsonGetLongAfterKey(obj, 0, "magic", cmd.magic))
      cmd.magic = 0;
   return (StringLen(cmd.symbol) > 0 && cmd.volume > 0);
}

//+------------------------------------------------------------------+
int ParseCommandsFromJson(const string json, EaCommand &cmds[])
{
   int n = 0;
   int c0 = StringFind(json, "\"commands\"");
   if(c0 < 0)
      return 0;
   int br = StringFind(json, "[", c0);
   if(br < 0)
      return 0;
   int pos = br + 1;
   int len = StringLen(json);
   while(n < MAX_EA_COMMANDS && pos < len)
   {
      int ch = StringGetCharacter(json, pos);
      while(pos < len && (ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n'))
      {
         pos++;
         if(pos >= len)
            break;
         ch = StringGetCharacter(json, pos);
      }
      if(pos >= len)
         break;
      if(ch == ']')
         break;
      if(ch == ',')
      {
         pos++;
         continue;
      }
      int ob = StringFind(json, "{", pos);
      if(ob < 0)
         break;
      int end_b = 0;
      if(!ExtractBraceObject(json, ob, end_b))
         break;
      int obj_len = end_b - ob + 1;
      string obj = StringSubstr(json, ob, obj_len);
      EaCommand c;
      ZeroMemory(c);
      if(FillCommandFromJsonObject(obj, c))
      {
         cmds[n] = c;
         n++;
      }
      pos = end_b + 1;
   }
   return n;
}

//+------------------------------------------------------------------+
bool HttpPostJson(const string url, const string headers, const string body, int timeout_ms,
                  string &response_out, int &http_status)
{
   uchar data[];
   int sz = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(sz < 1)
      return false;
   uchar result[];
   string result_headers;
   ResetLastError();
   http_status = WebRequest("POST", url, headers, timeout_ms, data, sz, result, result_headers);
   if(http_status == -1)
   {
      response_out = "";
      return false;
   }
   response_out = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return true;
}

//+------------------------------------------------------------------+
bool HttpGet(const string url, const string headers, int timeout_ms, string &response_out, int &http_status)
{
   uchar post[];
   uchar result[];
   string result_headers;
   ResetLastError();
   http_status = WebRequest("GET", url, headers, timeout_ms, post, 0, result, result_headers);
   if(http_status == -1)
   {
      response_out = "";
      return false;
   }
   response_out = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return true;
}

//+------------------------------------------------------------------+
bool PostTelemetry(const string api_base)
{
   if(StringLen(InpEaBearerToken) < 16)
   {
      Print("EmaWebhookEa: set InpEaBearerToken (64+ hex from backend).");
      return false;
   }
   string login = IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN));
   string server = AccountInfoString(ACCOUNT_SERVER);
   string sym = _Symbol;
   double bid = SymbolInfoDouble(sym, SYMBOL_BID);
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   string body = "{";
   body += "\"login\":\"" + JsonEscape(login) + "\",";
   body += "\"server\":\"" + JsonEscape(server) + "\",";
   body += "\"symbol\":\"" + JsonEscape(sym) + "\",";
   body += "\"bid\":" + DoubleToString(bid, dg) + ",";
   body += "\"ask\":" + DoubleToString(ask, dg) + ",";
   body += "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   body += "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2);
   body += "}";
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + InpEaBearerToken + "\r\n";
   string resp;
   int st = 0;
   if(!HttpPostJson(api_base + "/webhooks/mt5-ea/telemetry", headers, body, 10000, resp, st))
   {
      Print("EmaWebhookEa: telemetry WebRequest failed. Err=", GetLastError(), " (add URL in Terminal options → Expert Advisors → Allow WebRequest)");
      return false;
   }
   if(st < 200 || st >= 300)
      Print("EmaWebhookEa: telemetry HTTP ", st, " body=", StringSubstr(resp, 0, 200));
   return (st >= 200 && st < 300);
}

//+------------------------------------------------------------------+
bool PostAck(const string api_base, const string command_id, const string status, const long ticket, const string err)
{
   string body = "{\"status\":\"" + status + "\"";
   if(status == "acked" && ticket > 0)
      body += ",\"ticket\":" + IntegerToString(ticket);
   if(status == "failed" && StringLen(err) > 0)
      body += ",\"error\":\"" + JsonEscape(err) + "\"";
   body += "}";
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + InpEaBearerToken + "\r\n";
   string url = api_base + "/webhooks/mt5-ea/commands/" + command_id + "/ack";
   string resp;
   int st = 0;
   if(!HttpPostJson(url, headers, body, 10000, resp, st))
   {
      Print("EmaWebhookEa: ack WebRequest failed. Err=", GetLastError());
      return false;
   }
   if(st < 200 || st >= 300)
      Print("EmaWebhookEa: ack HTTP ", st, " ", StringSubstr(resp, 0, 200));
   return (st >= 200 && st < 300);
}

//+------------------------------------------------------------------+
double NormalizeVolume(const string sym, double vol)
{
   double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   if(step <= 0)
      step = 0.01;
   if(vol < vmin)
      vol = vmin;
   if(vol > vmax)
      vol = vmax;
   double steps = MathFloor((vol - vmin) / step + 0.5);
   return vmin + steps * step;
}

//+------------------------------------------------------------------+
bool ExecuteOneCommand(const EaCommand &cmd, long &ticket_out, string &err_out)
{
   ticket_out = 0;
   err_out = "";
   string sym = cmd.symbol;
   if(!SymbolSelect(sym, true))
   {
      err_out = "SymbolSelect failed: " + sym;
      return false;
   }
   double vol = NormalizeVolume(sym, cmd.volume);
   double sl = 0;
   double tp = 0;
   if(cmd.has_sl)
      sl = cmd.stop_loss;
   if(cmd.has_tp)
      tp = cmd.take_profit;
   g_trade.SetExpertMagicNumber((int)cmd.magic);
   g_trade.SetDeviationInPoints((int)InpTradeDeviationPts);
   string cmt = "ema-ea-" + cmd.client_id;
   bool ok = false;
   string sd = cmd.side;
   StringToLower(sd);
   if(sd == "buy")
      ok = g_trade.Buy(vol, sym, 0, sl, tp, cmt);
   else if(sd == "sell")
      ok = g_trade.Sell(vol, sym, 0, sl, tp, cmt);
   else
   {
      err_out = "Unknown side: " + cmd.side;
      return false;
   }
   if(!ok)
   {
      err_out = g_trade.ResultRetcodeDescription();
      return false;
   }
   ticket_out = (long)g_trade.ResultOrder();
   return true;
}

//+------------------------------------------------------------------+
void PollAndProcessCommands(const string api_base)
{
   if(StringLen(InpEaBearerToken) < 16)
      return;
   string headers = "Authorization: Bearer " + InpEaBearerToken + "\r\n";
   string json;
   int st = 0;
   if(!HttpGet(api_base + "/webhooks/mt5-ea/commands", headers, 10000, json, st))
   {
      Print("EmaWebhookEa: commands GET failed. Err=", GetLastError());
      return;
   }
   if(st < 200 || st >= 300)
   {
      Print("EmaWebhookEa: commands HTTP ", st, " ", StringSubstr(json, 0, 200));
      return;
   }
   EaCommand cmds[MAX_EA_COMMANDS];
   int n = ParseCommandsFromJson(json, cmds);
   if(n <= 0)
      return;
   for(int i = 0; i < n; i++)
   {
      long ticket = 0;
      string err = "";
      if(!InpExecuteCommands)
      {
         Print("EmaWebhookEa: dry-run command id=", cmds[i].id, " ", cmds[i].side, " ", cmds[i].symbol, " vol=", cmds[i].volume);
         PostAck(api_base, cmds[i].id, "failed", 0, "ExecuteCommands=false");
         continue;
      }
      if(!ExecuteOneCommand(cmds[i], ticket, err))
      {
         Print("EmaWebhookEa: execute failed id=", cmds[i].id, " err=", err);
         PostAck(api_base, cmds[i].id, "failed", 0, err);
         continue;
      }
      Print("EmaWebhookEa: executed id=", cmds[i].id, " ticket=", ticket);
      PostAck(api_base, cmds[i].id, "acked", ticket, "");
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   string base = TrimApiBase(InpApiBase);
   if(StringFind(base, "https://") != 0)
   {
      Alert("EmaWebhookEa: InpApiBase must start with https://");
      return INIT_PARAMETERS_INCORRECT;
   }
   EventSetTimer(1);
   g_last_telemetry = 0;
   g_last_poll = 0;
   Print("EmaWebhookEa: started. ApiBase=", base, " (allow WebRequest for this host in Terminal settings)");
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
}

//+------------------------------------------------------------------+
void OnTimer()
{
   string base = TrimApiBase(InpApiBase);
   datetime now = TimeGMT();
   if(g_last_telemetry == 0)
      g_last_telemetry = now;
   if(g_last_poll == 0)
      g_last_poll = now;
   if((now - g_last_telemetry) >= InpTelemetrySeconds)
   {
      g_last_telemetry = now;
      PostTelemetry(base);
   }
   if((now - g_last_poll) >= InpPollSeconds)
   {
      g_last_poll = now;
      PollAndProcessCommands(base);
   }
}

//+------------------------------------------------------------------+
