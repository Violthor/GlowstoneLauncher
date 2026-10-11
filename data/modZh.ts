// 资源中文名解析：PCL2 的 MC 百科中文名库（wikiZh.json，slug -> 中文全名）为第一权威来源，
// 社区补充译名表 EXTRA_ZH（覆盖整合包/数据包/资源包/光影等官方库缺录项）次之，
// 内置小字典（MODRINTH_ZH_MAP）作为简介与漏网项的最后补充。
import type { MODRINTH_ZH_MAP } from './launcher';
import { EXTRA_ZH } from './extraZh';

type Wiki = Record<string, string>;
type Small = typeof MODRINTH_ZH_MAP;

/**
 * 从中文全名提取中文主名（对齐 PCL2 ResourceProject.vb 的 Title 拆分）：
 * 含半角 " (" 时取其前；否则取最后一个 " - " 前；都没有则整体。例：
 * “模组菜单 (Mod Menu)” -> “模组菜单”；“钠 (Sodium)” -> “钠”。
 */
export function pickZhTitle(full: string): string {
  let t = full ?? '';
  const pi = t.indexOf(' (');
  if (pi >= 0) t = t.slice(0, pi);
  else {
    const di = t.lastIndexOf(' - ');
    if (di >= 0) t = t.slice(0, di);
  }
  return t.trim();
}

/** 解析某个 Modrinth slug 的中文名与中文简介。name 为空表示无中文翻译（此时应显示英文原名）。 */
export function resolveModZh(wiki: Wiki, small: Small, slug: string): { name: string; full: string; desc: string } {
  const k = (slug || '').toLowerCase();
  const full = wiki[k] || EXTRA_ZH[k] || '';
  const s = small[k as keyof Small];
  if (full) return { name: pickZhTitle(full), full, desc: s?.desc ?? '' };
  return { name: s?.name ?? '', full: '', desc: s?.desc ?? '' };
}

/** 中文关键词 -> 对应 Modrinth slug，用于“搜中文也能找到”。依次匹配小字典、社区补充表、PCL2 中文库。 */
export function findZhSlug(wiki: Wiki, small: Small, query: string): string | null {
  const q = query.trim();
  if (!q) return null;
  for (const [key, v] of Object.entries(small)) {
    if (v.name.includes(q) || v.desc.includes(q)) return key;
  }
  for (const [key, full] of Object.entries(EXTRA_ZH)) {
    if (full.includes(q)) return key;
  }
  for (const [slug, full] of Object.entries(wiki)) {
    if (full.includes(q)) return slug;
  }
  return null;
}
