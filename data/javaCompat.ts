// 版本 -> 必需 Java 大版本（前端展示用）。数据与主进程共用 electron/java-runtime-map.json 这一份权威映射，
// 构建时由 Vite 内联进 bundle，不在运行时读文件。传统 1.x 走区间，新年份版本 26.x 走 calendar。
import rtMap from '../../electron/java-runtime-map.json';

type LegacyRule = {
  minor?: number; minorMin?: number; minorMax?: number; patchMin?: number; patchMax?: number; java: number;
};
const legacy = rtMap.legacy as LegacyRule[];
const calendar = rtMap.calendar as Record<string, number>;
const defaultLatest = rtMap.defaultLatest as number;

export function parseMcVersion(id: string): { major: number; minor: number; patch: number } | null {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(id || '').trim());
  if (m) return { major: +m[1], minor: +m[2], patch: m[3] ? +m[3] : 0 };
  const w = /^(\d+)w/.exec(String(id || ''));
  if (w) return { major: +w[1], minor: -1, patch: 0 };
  return null;
}

export function requiredJavaMajor(versionId: string): number {
  const v = parseMcVersion(versionId);
  if (!v) return 21;
  if (v.major === 1) {
    for (const r of legacy) {
      if (r.minorMax != null && v.minor > r.minorMax) continue;
      if (r.minorMin != null && v.minor < r.minorMin) continue;
      if (r.minor != null && v.minor !== r.minor) continue;
      if (r.patchMax != null && v.patch > r.patchMax) continue;
      if (r.patchMin != null && v.patch < r.patchMin) continue;
      return r.java;
    }
    return 21;
  }
  return calendar[String(v.major)] ?? defaultLatest;
}
