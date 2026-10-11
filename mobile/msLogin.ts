// Microsoft 设备码登录（手机端）。UI 流程与电脑版一致：显示用户码 -> 用户在 microsoft.com/link
// 输入 -> 轮询 -> XBL -> XSTS -> Minecraft -> Profile。所有 HTTP 走原生 'http-request' 代理，
// 以绕过 WebView 对微软/Xbox 端点的 CORS 限制；成功后由原生 'save-account' 持久化为游戏账号。

/* eslint-disable @typescript-eslint/no-explicit-any */
const MS_CLIENT_ID = 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb';
const MS_DEVICE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const UA = 'GlowstoneLauncher/1.0';

type Call = (method: string, arg?: any) => Promise<any>;

function resolveClientId(arg: any): string {
  const c = arg && typeof arg === 'object' ? arg.clientId : '';
  return typeof c === 'string' &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(c.trim())
    ? c.trim() : MS_CLIENT_ID;
}

async function http(
  call: Call,
  method: string,
  url: string,
  opts: { headers?: Record<string, string>; body?: string; form?: Record<string, string> },
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  let body = opts.body;
  if (opts.form) {
    body = new URLSearchParams(opts.form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const res = await call('http-request', { method, url, headers, body });
  let data = res.body;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { /* keep text */ } }
  return { status: res.status, data };
}

async function postJsonRetry(call: Call, url: string, payload: any, stage: string) {
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await http(call, 'POST', url, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify(payload),
      });
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 700)); }
  }
  throw new Error(stage + '网络请求失败：' + String(lastErr?.message || lastErr));
}

export async function deviceCode(arg: any): Promise<any> {
  // call 通过 this 不可用，改为由 bridge 注入：这里用全局保存的 call
  const call = (globalThis as any).__glowCall as Call;
  if (!call) return { success: false, error: 'bridge_not_ready' };
  try {
    const clientId = resolveClientId(arg);
    const res = await http(call, 'POST', MS_DEVICE_URL, {
      form: { client_id: clientId, scope: 'XboxLive.signin offline_access' },
    });
    const d = res.data || {};
    if (res.status !== 200 || !d.device_code) {
      return { success: false, error: d.error || 'device_code_failed', description: typeof d === 'string' ? d : JSON.stringify(d) };
    }
    return {
      success: true,
      data: {
        device_code: d.device_code,
        user_code: d.user_code,
        verification_uri: d.verification_uri || 'https://www.microsoft.com/link',
        interval: d.interval || 5,
        expires_in: d.expires_in || 900,
      },
    };
  } catch (err: any) {
    return { success: false, error: String(err?.message || err) };
  }
}

export async function pollToken(arg: any, call: Call): Promise<any> {
  (globalThis as any).__glowCall = call;
  const deviceCodeStr = typeof arg === 'string' ? arg : arg?.deviceCode;
  const clientId = resolveClientId(typeof arg === 'object' ? arg : null);
  try {
    // 1) device code -> MS access token
    let res;
    try {
      res = await http(call, 'POST', MS_TOKEN_URL, {
        headers: { 'User-Agent': UA },
        form: {
          client_id: clientId,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCodeStr,
        },
      });
    } catch {
      return { success: false, error: 'network_error', description: '无法连接微软登录服务器，请检查网络后等待自动重试' };
    }
    const td = res.data || {};
    if (res.status !== 200 || !td.access_token) {
      return { success: false, error: td.error || 'poll_failed', description: td.error_description || '' };
    }
    const msAccessToken = td.access_token;
    const refreshToken = td.refresh_token || '';

    // 2) XBL
    const xblRes = await postJsonRetry(call, 'https://user.auth.xboxlive.com/user/authenticate', {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccessToken },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }, 'Xbox Live');
    if (xblRes.status !== 200) {
      return { success: false, error: 'xbl_auth_failed', description: 'Xbox Live 认证失败 (' + xblRes.status + ')' };
    }
    const xblToken = xblRes.data.Token;
    const userHash = xblRes.data.DisplayClaims?.xui?.[0]?.uhs;
    if (!xblToken || !userHash) return { success: false, error: 'xbl_auth_failed', description: 'Xbox Live 返回数据缺失，请重试' };

    // 3) XSTS
    const xstsRes = await postJsonRetry(call, 'https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }, 'XSTS');
    if (xstsRes.status !== 200) {
      const xerr = xstsRes.data?.XErr;
      let msg = 'XSTS 认证失败，请检查网络后重试';
      if (xerr === 2148916233) msg = '该微软账号没有 Xbox 档案，请先在 Xbox 官网免费注册一个玩家标签';
      else if (xerr === 2148916235) msg = '当前地区 Xbox Live 不可用，需要切换网络环境';
      else if (xerr === 2148916238) msg = '该账号是未成年人账号，需要加入家庭组才能登录';
      else if (xerr === 2148916236 || xerr === 2148916237) msg = '需要成人验证，请在微软账号完成年龄验证';
      return { success: false, error: 'xsts_failed', description: msg };
    }

    // 4) Minecraft services
    const mcRes = await postJsonRetry(call, 'https://api.minecraftservices.com/authentication/login_with_xbox', {
      identityToken: 'XBL3.0 x=' + userHash + ';' + xstsRes.data.Token,
    }, 'Minecraft');
    if (mcRes.status !== 200 || !mcRes.data.access_token) {
      return { success: false, error: 'mc_auth_failed', description: 'Minecraft 令牌换取失败 (' + mcRes.status + ')' };
    }
    const mcToken = mcRes.data.access_token;

    // 5) Profile (ownership)
    const profileRes = await http(call, 'GET', 'https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: 'Bearer ' + mcToken, Accept: 'application/json', 'User-Agent': UA },
    });
    if (profileRes.status !== 200 || !profileRes.data.id) {
      return { success: false, error: 'no_game_ownership', description: '该微软账号未拥有 Minecraft Java 版，请先在官方购买' };
    }

    // 6) 持久化为原生游戏账号
    const account = {
      type: 'microsoft',
      username: profileRes.data.name,
      uuid: profileRes.data.id,
      accessToken: mcToken,
      refreshToken,
    };
    await call('save-account', account);

    return { success: true, data: { username: account.username, uuid: account.uuid, accessToken: mcToken, refreshToken } };
  } catch (err: any) {
    return { success: false, error: 'exception', description: String(err?.message || err) };
  }
}
