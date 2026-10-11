// 资源下载统一数据层：Modrinth + CurseForge 双源，全部走 MCIM 国内镜像（mod.mcimirror.top），
// Modrinth 镜像失败时回退官方 api.modrinth.com。所有请求带超时与外部 AbortSignal（竞态保护）。

// ---------------- 类型 ----------------
export type ResourceType = 'mod' | 'modpack' | 'datapack' | 'resourcepack' | 'shader';
export type SourceName = 'modrinth' | 'curseforge';
export type ReleaseKind = 'release' | 'beta' | 'alpha';

export interface NormProject {
  source: SourceName;
  id: string;
  slug: string;
  title: string;
  description: string;
  iconUrl: string | null;
  categories: string[];
  downloads: number;
  follows: number;
  dateModified: number;
  dateCreated: number;
  author: string;
}

export interface NormDependency {
  source: SourceName;
  kind: 'required' | 'optional' | 'embedded' | 'incompatible';
  projectId?: string;
  fileId?: string;
}

export interface NormFile {
  source: SourceName;
  id: string;
  name: string;
  fileName: string;
  url: string;
  size: number;
  gameVersions: string;
  loaders: string[];
  releaseType: ReleaseKind;
  datePublished: number;
  dependencies: NormDependency[];
}

export interface BrowseQuery {
  keyword?: string;
  category?: string;   // 分类 key（all=不限）
  gameVersion?: string;
  loader?: string;     // 加载器 key（all=不限）
  offset: number;
  pageSize: number;
}

// ---------------- 端点 ----------------
const MR_MIRROR = 'https://mod.mcimirror.top/modrinth/v2';
const CF_MIRROR = 'https://mod.mcimirror.top/curseforge/v1';
const MR_DIRECT = 'https://api.modrinth.com/v2';

// CurseForge Minecraft 各资源 classId
export const CF_CLASS: Record<ResourceType, number> = {
  mod: 6,
  resourcepack: 12,
  modpack: 4471,
  shader: 6552,
  datapack: 6945,
};

// CurseForge modLoaderType 枚举
const CF_LOADER_INT: Record<string, number> = {
  forge: 1, liteloader: 3, fabric: 4, quilt: 5, neoforge: 6,
};

// ---------------- 请求工具 ----------------
async function getJson(url: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function postJson(url: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const r = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', onAbort);
  }
}

// ---------------- 通用小工具 ----------------
const LOADER_TOKENS = ['forge', 'fabric', 'quilt', 'neoforge', 'liteloader', 'rift', 'iris', 'optifine', 'canvas'];
export function isMcVersionToken(s: string): boolean {
  return /^\d+(\.\d+)*$/.test(s) || /^\d{2}w\d{2}[a-z]$/.test(s) || /^(?:pre|rc)\d*$/i.test(s);
}
function cfLoadersOf(tokens: string[]): string[] {
  const out: string[] = [];
  for (const tok of tokens) {
    const t = tok.toLowerCase();
    if (LOADER_TOKENS.includes(t) && !out.includes(t)) out.push(t);
  }
  return out;
}
function cfMcVersionsOf(tokens: string[]): string[] {
  return tokens.filter((t) => isMcVersionToken(t));
}
const CF_RELEASE: Record<number, ReleaseKind> = { 1: 'release', 2: 'beta', 3: 'alpha' };
function cfRelation(rt: number): NormDependency['kind'] | null {
  switch (rt) {
    case 1: return 'embedded';
    case 2: return 'incompatible';
    case 3: return 'required';
    case 4: return 'optional';
    default: return null;
  }
}
const toMs = (s?: string): number => { const n = s ? Date.parse(s) : NaN; return isNaN(n) ? 0 : n; };

// ---------------- Modrinth 归一化 ----------------
interface MrSearchResponse { hits: Array<Record<string, unknown>>; total_hits: number }
interface RawMrProject {
  project_id: string; slug: string; title: string; description: string;
  categories: string[]; downloads: number; follows: number;
  date_modified: string; date_created?: string; icon_url: string | null; author?: string;
}
function normMrProject(hit: Record<string, unknown>): NormProject {
  const p = hit as unknown as RawMrProject;
  return {
    source: 'modrinth', id: p.project_id, slug: p.slug, title: p.title,
    description: p.description, iconUrl: p.icon_url, categories: p.categories || [],
    downloads: p.downloads || 0, follows: p.follows || 0,
    dateModified: toMs(p.date_modified), dateCreated: toMs(p.date_created),
    author: (p.author as string) || '',
  };
}

interface RawMrVersion {
  id: string; name: string; version_number: string; game_versions: string[]; loaders: string[];
  date_published: string; version_type: string;
  files: Array<{ url: string; filename: string; size: number; primary: boolean }>;
  dependencies?: Array<{
    version_id: string | null; project_id: string | null;
    dependency_type: 'required' | 'optional' | 'embedded' | 'incompatible';
  }>;
}
function normMrFile(v: RawMrVersion): NormFile | null {
  const f = v.files?.find((x) => x.primary) || v.files?.[0];
  if (!f) return null;
  return {
    source: 'modrinth', id: v.id, name: v.name, fileName: f.filename, url: f.url,
    size: f.size, gameVersions: v.game_versions || [], loaders: v.loaders || [],
    releaseType: (v.version_type as ReleaseKind) || 'release',
    datePublished: toMs(v.date_published),
    dependencies: (v.dependencies || []).map((d) => ({
      source: 'modrinth' as const, kind: d.dependency_type,
      projectId: d.project_id || undefined, fileId: d.version_id || undefined,
    })),
  };
}

// ---------------- CurseForge 归一化 ----------------
interface RawCfMod {
  id: number; slug: string; name: string; summary: string;
  categories?: Array<{ name: string }>; downloadCount: number;
  dateModified: string; dateCreated: string;
  logo?: { thumbnailUrl: string; url: string }; authors?: Array<{ name: string }>;
}
function normCfProject(m: RawCfMod): NormProject {
  return {
    source: 'curseforge', id: String(m.id), slug: m.slug, title: m.name,
    description: m.summary, iconUrl: m.logo?.thumbnailUrl || m.logo?.url || null,
    categories: (m.categories || []).map((c) => c.name),
    downloads: m.downloadCount || 0, follows: 0,
    dateModified: toMs(m.dateModified), dateCreated: toMs(m.dateCreated),
    author: m.authors?.[0]?.name || '',
  };
}

interface RawCfFile {
  id: number; displayName: string; fileName: string; downloadUrl: string;
  fileLength: number; gameVersions: string[]; releaseType: number; fileDate: string;
  dependencies?: Array<{ modId: number; relationType: number; fileId?: number }>;
}
function normCfFile(f: RawCfFile): NormFile | null {
  if (!f.downloadUrl) return null;
  const loaders = cfLoadersOf(f.gameVersions || []);
  const gv = cfMcVersionsOf(f.gameVersions || []);
  return {
    source: 'curseforge', id: String(f.id), name: f.displayName || f.fileName,
    fileName: f.fileName, url: f.downloadUrl, size: f.fileLength || 0,
    gameVersions: gv, loaders,
    releaseType: CF_RELEASE[f.releaseType] || 'release',
    datePublished: toMs(f.fileDate),
    dependencies: (f.dependencies || []).map((d) => {
      const kind = cfRelation(d.relationType);
      return {
        source: 'curseforge' as const, kind: (kind || 'optional') as NormDependency['kind'],
        projectId: d.modId != null ? String(d.modId) : undefined,
        fileId: d.fileId != null ? String(d.fileId) : undefined,
      };
    }).filter((d) => d.kind !== 'incompatible'),
  };
}

// ---------------- CurseForge 分类缓存 ----------------
let cfCategoryPromise: Promise<Map<string, number>> | null = null;
// 拉取 CF 全部分类，建立 name(lower) -> id 映射（用于分类筛选）
function loadCfCategories(signal?: AbortSignal): Promise<Map<string, number>> {
  if (cfCategoryPromise) return cfCategoryPromise;
  cfCategoryPromise = (async () => {
    const map = new Map<string, number>();
    try {
      const data = (await getJson(`${CF_MIRROR}/categories?gameId=432`, 20000, signal)) as Array<{ id: number; name: string }>;
      for (const c of data) map.set(c.name.toLowerCase(), c.id);
    } catch { /* 忽略：分类筛选不可用时退化为不筛选 */ }
    return map;
  })();
  return cfCategoryPromise;
}

// ---------------- 浏览 / 搜索 ----------------
// Modrinth：facets 精确过滤 + 全可用关键词搜索
export async function browseModrinth(type: ResourceType, q: BrowseQuery, signal?: AbortSignal): Promise<{ projects: NormProject[]; total: number }> {
  const facets: string[][] = [[`project_type:${type}`]];
  if (q.gameVersion) facets.push([`versions:${q.gameVersion}`]);
  if (q.loader && q.loader !== 'all') facets.push([`categories:${q.loader}`]);
  if (q.category && q.category !== 'all') facets.push([`categories:${q.category}`]);
  const params = new URLSearchParams({
    limit: String(q.pageSize), offset: String(q.offset), facets: JSON.stringify(facets),
    index: 'relevance',
  });
  if (q.keyword) params.set('query', q.keyword);

  const url = `${MR_MIRROR}/search?${params}`;
  try {
    const data = (await getJson(url, 15000, signal)) as MrSearchResponse;
    return { projects: (data.hits || []).map(normMrProject), total: data.total_hits || 0 };
  } catch (e) {
    // 镜像失败回退官方 Modrinth
    if ((e as Error)?.name === 'AbortError') throw e;
    const direct = `${MR_DIRECT}/search?${params}`;
    const data = (await getJson(direct, 15000, signal)) as MrSearchResponse;
    return { projects: (data.hits || []).map(normMrProject), total: data.total_hits || 0 };
  }
}

// 把用户输入归一化为 CurseForge slug（小写、非字母数字转连字符）；全中文等无法构成 slug 时返回 ''
function toCfSlug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// CurseForge：
//  - 无关键词：按总下载量排序做分类浏览（真热门）。
//  - 有关键词：MCIM 镜像对 CF 的全文 searchFilter 匹配较弱（常搜不到模组本体），
//    因此额外用官方 slug 精确参数命中模组本体并置顶，再用 searchFilter（按总下载量）补充相关/附属模组。
//    镜像偶发 502/超时，两路均容错，互不阻断。
export async function browseCurseforge(type: ResourceType, q: BrowseQuery, signal?: AbortSignal): Promise<{ projects: NormProject[]; total: number }> {
  const classId = String(CF_CLASS[type]);
  const applyVersionFilters = (params: URLSearchParams) => {
    if (q.gameVersion) params.set('gameVersion', q.gameVersion);
    if (q.loader && q.loader !== 'all' && CF_LOADER_INT[q.loader]) {
      params.set('modLoaderType', String(CF_LOADER_INT[q.loader]));
    }
  };

  // 无关键词：分类浏览
  if (!q.keyword) {
    const params = new URLSearchParams({
      gameId: '432', classId,
      pageSize: String(q.pageSize), index: String(q.offset),
      sortField: '6', // 6=TotalDownloads，取真正热门（1=Featured 在镜像上常返回冷门）
    });
    if (q.gameVersion) params.set('gameVersion', q.gameVersion);
    if (q.loader && q.loader !== 'all' && CF_LOADER_INT[q.loader]) {
      params.set('modLoaderType', String(CF_LOADER_INT[q.loader]));
    }
    if (q.category && q.category !== 'all') {
      const cats = await loadCfCategories(signal);
      const cid = cats.get(q.category.toLowerCase());
      if (cid) params.set('categoryIds', String(cid));
    }
    const data = (await getJson(`${CF_MIRROR}/mods/search?${params}`, 15000, signal)) as {
      data: RawCfMod[]; pagination: { totalCount: number };
    };
    return { projects: (data.data || []).map(normCfProject), total: data.pagination?.totalCount || 0 };
  }

  // 有关键词：slug 精确（本体，不带版本/子类过滤，避免滤掉）+ searchFilter 模糊（带筛选，按总下载量）
  const slug = toCfSlug(q.keyword);
  const [slugRaw, fuzzy] = await Promise.all([
    (async (): Promise<RawCfMod[]> => {
      if (!slug) return [];
      const p = new URLSearchParams({ gameId: '432', classId, slug, pageSize: '1' });
      try {
        const d = (await getJson(`${CF_MIRROR}/mods/search?${p}`, 12000, signal)) as { data: RawCfMod[] };
        return d.data || [];
      } catch { return []; }
    })(),
    (async (): Promise<{ items: RawCfMod[]; total: number }> => {
      const p = new URLSearchParams({
        gameId: '432', classId, pageSize: String(q.pageSize),
        index: String(q.offset), sortField: '6', searchFilter: q.keyword,
      });
      applyVersionFilters(p);
      try {
        const d = (await getJson(`${CF_MIRROR}/mods/search?${p}`, 15000, signal)) as {
          data: RawCfMod[]; pagination: { totalCount: number };
        };
        return { items: d.data || [], total: d.pagination?.totalCount || 0 };
      } catch { return { items: [], total: 0 }; }
    })(),
  ]);

  // 合并去重：slug 精确命中置顶，模糊结果补充
  const seen = new Set<number>();
  const merged: RawCfMod[] = [];
  for (const m of [...slugRaw, ...fuzzy.items]) {
    if (m && m.id != null && !seen.has(m.id)) { seen.add(m.id); merged.push(m); }
  }
  return { projects: merged.map(normCfProject), total: Math.max(fuzzy.total, merged.length) };
}

// 双源合并浏览：无关键词时 CF + MR 合并去重；有关键词时仅 MR（CF 关键词失效）。
// 按 slug 去重（跨平台同项目），优先保留信息更全者，交错排列。
export async function browseBoth(type: ResourceType, q: BrowseQuery, signal?: AbortSignal): Promise<{ projects: NormProject[]; total: number }> {
  const [mr, cf] = await Promise.all([
    browseModrinth(type, q, signal).catch(() => ({ projects: [] as NormProject[], total: 0 })),
    browseCurseforge(type, q, signal).catch(() => ({ projects: [] as NormProject[], total: 0 })),
  ]);
  const bySlug = new Map<string, NormProject>();
  const order: string[] = [];
  const push = (p: NormProject) => {
    const key = (p.slug || p.id).toLowerCase();
    const ex = bySlug.get(key);
    if (!ex) { bySlug.set(key, p); order.push(key); }
    else if (p.downloads > ex.downloads) bySlug.set(key, { ...ex, ...p });
  };
  // 交错：先 CF 再 MR，保证 CurseForge 内容确实出现在列表
  cf.projects.forEach(push);
  mr.projects.forEach(push);
  const merged = order.map((k) => bySlug.get(k)!)
    .sort((a, b) => b.downloads - a.downloads);
  return { projects: merged, total: Math.max(mr.total, cf.total) };
}

// ---------------- 版本 / 文件 ----------------
export async function getModrinthFiles(projectId: string, q: { gameVersion?: string; loader?: string }, signal?: AbortSignal): Promise<NormFile[]> {
  const params = new URLSearchParams();
  if (q.loader && q.loader !== 'all') params.set('loaders', JSON.stringify([q.loader]));
  if (q.gameVersion) params.set('game_versions', JSON.stringify([q.gameVersion]));
  const fetchList = async (base: string) =>
    (await getJson(`${base}/project/${projectId}/version?${params}`, 15000, signal)) as RawMrVersion[];
  let list: RawMrVersion[];
  try { list = await fetchList(MR_MIRROR); }
  catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    list = await fetchList(MR_DIRECT);
  }
  return (list || []).map(normMrFile).filter((x): x is NormFile => !!x);
}

export async function getCurseforgeFiles(projectId: string, q: { gameVersion?: string; loader?: string }, signal?: AbortSignal): Promise<NormFile[]> {
  const params = new URLSearchParams({ pageSize: '50' });
  if (q.gameVersion) params.set('gameVersion', q.gameVersion);
  if (q.loader && q.loader !== 'all' && CF_LOADER_INT[q.loader]) {
    params.set('modLoaderType', String(CF_LOADER_INT[q.loader]));
  }
  const data = (await getJson(`${CF_MIRROR}/mods/${projectId}/files?${params}`, 20000, signal)) as {
    data: RawCfFile[];
  };
  return (data.data || []).map(normCfFile).filter((x): x is NormFile => !!x);
}

// ---------------- 项目 / 依赖详情 ----------------
export async function getModrinthProject(projectId: string, signal?: AbortSignal): Promise<NormProject> {
  const fetchOne = async (base: string) =>
    (await getJson(`${base}/project/${projectId}`, 15000, signal)) as Record<string, unknown> & { project_id?: string };
  let raw: Record<string, unknown>;
  try { raw = await fetchOne(MR_MIRROR); }
  catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    raw = await fetchOne(MR_DIRECT);
  }
  // 详情接口用 id 字段，归一化函数期望 project_id
  raw.project_id = (raw.project_id as string) || (raw.id as string);
  return normMrProject(raw);
}

export async function getCurseforgeProject(projectId: string, signal?: AbortSignal): Promise<NormProject> {
  const data = (await getJson(`${CF_MIRROR}/mods/${projectId}`, 15000, signal)) as { data: RawCfMod };
  return normCfProject(data.data);
}

// 批量解析 Modrinth 项目标题（依赖）
export async function getModrinthProjects(ids: string[], signal?: AbortSignal): Promise<Map<string, NormProject>> {
  const map = new Map<string, NormProject>();
  if (!ids.length) return map;
  const fetchBatch = async (base: string) =>
    (await getJson(`${base}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`, 15000, signal)) as Array<Record<string, unknown>>;
  let list: Array<Record<string, unknown>>;
  try { list = await fetchBatch(MR_MIRROR); }
  catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    list = await fetchBatch(MR_DIRECT);
  }
  for (const raw of list) {
    raw.project_id = (raw.project_id as string) || (raw.id as string);
    const p = normMrProject(raw);
    map.set(p.id, p);
  }
  return map;
}

// 批量解析 CurseForge 项目标题（依赖）：优先 POST /mods 批量，失败则逐个拉取
export async function getCurseforgeProjects(ids: string[], signal?: AbortSignal): Promise<Map<string, NormProject>> {
  const map = new Map<string, NormProject>();
  if (!ids.length) return map;
  const intIds = ids.map(Number).filter((n) => !isNaN(n));
  try {
    const res = await postJson(`${CF_MIRROR}/mods`, { modIds: intIds }, 20000, signal) as { data: RawCfMod[] };
    for (const m of res.data || []) map.set(String(m.id), normCfProject(m));
  } catch {
    // 回退逐个（少量并发由调用方控制；此处顺序，依赖数量通常很少）
    for (const id of intIds) {
      try {
        const res = (await getJson(`${CF_MIRROR}/mods/${id}`, 12000, signal)) as { data: RawCfMod };
        map.set(String(id), normCfProject(res.data));
      } catch { /* 单个失败忽略 */ }
    }
  }
  return map;
}

// 取某 CurseForge 文件的精确信息（依赖里给的是 fileId 时）
export async function getCurseforgeFileById(projectId: string, fileId: string, signal?: AbortSignal): Promise<NormFile | null> {
  try {
    const data = (await getJson(`${CF_MIRROR}/mods/${projectId}/files/${fileId}`, 12000, signal)) as { data: RawCfFile };
    return normCfFile(data.data);
  } catch { return null; }
}
export async function getModrinthFileById(versionId: string, signal?: AbortSignal): Promise<NormFile | null> {
  const fetchOne = async (base: string) =>
    (await getJson(`${base}/version/${versionId}`, 12000, signal)) as RawMrVersion;
  try { return normMrFile(await fetchOne(MR_MIRROR)); }
  catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    try { return normMrFile(await fetchOne(MR_DIRECT)); } catch { return null; }
  }
}
