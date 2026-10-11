import { useEffect, useState } from 'react';

export interface McmodLive {
  zh: string;
  en: string;
  url: string;
}

// 实时向 MC百科（mcmod.cn，经主进程）查询某 slug 的中文译名；主进程侧带缓存。
// 失败/无结果返回 null，由调用方回退内置译名表或英文原名。
export function useMcmodZh(slug: string | undefined): McmodLive | null {
  const [r, setR] = useState<McmodLive | null>(null);
  useEffect(() => {
    if (!slug) return undefined;
    let on = true;
    setR(null);
    const api = (window as unknown as { electronAPI?: { mcmodLookup?: (q: string) => Promise<Record<string, unknown>> } }).electronAPI;
    api?.mcmodLookup?.(slug)
      .then((x) => { if (on && x.success) setR({ zh: String(x.zh || ''), en: String(x.en || ''), url: String(x.url || '') }); })
      .catch(() => {});
    return () => { on = false; };
  }, [slug]);
  return r;
}
