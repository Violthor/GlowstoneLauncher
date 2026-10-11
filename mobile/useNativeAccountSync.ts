// 手机端：把前端当前账号同步到原生侧。
// 原生与前端各有一套账号库：登录（任意类型）、切换账号、冷启动恢复时，前端当前账号
// 若不同步，MainActivity 读取当前 profile 为 null，启动即报“读取 null.username”。
// 这里监听当前账号，变化即调用原生 save-account（写账号文件 + 设当前 profile）。
import { useEffect, useRef } from 'react';
import { useLauncherStore } from '@/hooks/useLauncherStore';
import { isMobileHost } from './bridge';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getApi(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI ?? null;
}

export function useNativeAccountSync(): void {
  const { account } = useLauncherStore();
  const lastSynced = useRef<string>('');

  useEffect(() => {
    if (!isMobileHost()) return;
    if (!account || !account.username) return;
    // 以“身份 + 关键字段”生成签名，内容没变就不重复同步
    const sig = [
      account.id, account.username, account.uuid, account.accessToken,
      account.type, account.externalServer, account.skinUrl ? 1 : 0,
    ].join('|');
    if (sig === lastSynced.current) return;
    lastSynced.current = sig;

    const api = getApi();
    if (!api?.saveAccount) return;
    const payload = {
      username: account.username,
      uuid: account.uuid || '00000000-0000-0000-0000-000000000000',
      accessToken: account.accessToken || '0',
      refreshToken: '0',
      isMicrosoft: account.type === 'microsoft',
      ...(account.type === 'external' && account.externalServer
        ? { externalServer: account.externalServer }
        : {}),
    };
    api.saveAccount(payload).catch(() => { /* 同步失败不阻断界面；启动前还有兜底 */ });
  }, [account]);
}
