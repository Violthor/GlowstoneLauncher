import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Download, Clock, Package, X, ChevronDown, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { toast } from 'sonner';
import { useLauncherStore } from '@/hooks/useLauncherStore';
import { MODRINTH_ZH_MAP } from '@/data/launcher';
import { resolveModZh, findZhSlug } from '@/data/modZh';
import { useMcmodZh } from './useMcmodZh';
import ResourceDetail from './ResourceDetail';
import {
  ResourceType, NormProject, browseBoth,
} from './resourceApi';

const RESOURCE_TABS: { key: ResourceType; label: string }[] = [
  { key: 'mod', label: 'Mod' },
  { key: 'modpack', label: '整合包' },
  { key: 'datapack', label: '数据包' },
  { key: 'resourcepack', label: '资源包' },
  { key: 'shader', label: '光影包' },
];

// 分类筛选（key 对齐 Modrinth categories；CurseForge 经名称映射）
const CATEGORY_FILTERS: Record<ResourceType, { key: string; label: string }[]> = {
  mod: [
    { key: 'all', label: '全部分类' }, { key: 'optimization', label: '性能优化' },
    { key: 'utility', label: '实用工具' }, { key: 'technology', label: '科技' },
    { key: 'magic', label: '魔法' }, { key: 'adventure', label: '冒险' },
    { key: 'decoration', label: '装饰' }, { key: 'worldgen', label: '世界生成' },
    { key: 'combat', label: '战斗' }, { key: 'mobs', label: '生物' },
    { key: 'food', label: '食物' }, { key: 'storage', label: '存储' },
    { key: 'library', label: '依赖库' }, { key: 'cursed', label: '搞怪魔性' },
  ],
  modpack: [
    { key: 'all', label: '全部分类' }, { key: 'optimization', label: '性能优化' },
    { key: 'technology', label: '科技' }, { key: 'magic', label: '魔法' },
    { key: 'adventure', label: '冒险' }, { key: 'combat', label: '战斗' },
    { key: 'lightweight', label: '轻量' }, { key: 'multiplayer', label: '多人' },
    { key: 'quest', label: '任务' },
  ],
  datapack: [
    { key: 'all', label: '全部分类' }, { key: 'utility', label: '实用工具' },
    { key: 'technology', label: '科技' }, { key: 'magic', label: '魔法' },
    { key: 'adventure', label: '冒险' }, { key: 'worldgen', label: '世界生成' },
    { key: 'mobs', label: '生物' }, { key: 'combat', label: '战斗' },
    { key: 'cursed', label: '搞怪魔性' },
  ],
  resourcepack: [
    { key: 'all', label: '全部分类' }, { key: 'realistic', label: '写实' },
    { key: 'cartoon', label: '卡通' }, { key: 'themed', label: '主题' },
    { key: 'simplistic', label: '简约' }, { key: 'medieval', label: '中世纪' },
    { key: 'fantasy', label: '奇幻' }, { key: 'scifi', label: '科幻' },
    { key: 'vanilla', label: '原版改良' },
  ],
  shader: [
    { key: 'all', label: '全部分类' }, { key: 'realistic', label: '写实' },
    { key: 'cartoon', label: '卡通' }, { key: 'semi-realistic', label: '半写实' },
    { key: 'themed', label: '主题' }, { key: 'fantasy', label: '奇幻' },
    { key: 'scifi', label: '科幻' }, { key: 'vanilla', label: '原版改良' },
  ],
};

const LOADERS: Record<ResourceType, string[]> = {
  mod: ['fabric', 'forge', 'neoforge', 'quilt', 'liteloader'],
  modpack: ['forge', 'fabric', 'neoforge', 'quilt'],
  datapack: [],
  resourcepack: [],
  shader: ['iris', 'optifine', 'canvas'],
};
const LOADER_LABEL: Record<string, string> = {
  fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt',
  liteloader: 'LiteLoader', iris: 'Iris', optifine: 'OptiFine', canvas: 'Canvas',
};

const PAGE_SIZE = 20;

const fmtNum = (n: number) => {
  if (n >= 100000000) return `${(n / 100000000).toFixed(2)} 亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
  return String(n);
};
const fmtDate = (ms: number) => {
  if (!ms) return '';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
};

// 卡片标题：优先内置静态译名；缺失时才实时查 MC百科（传 undefined 给 hook → 不发请求）
function CardZhName({ slug, bundled, title }: { slug: string; bundled: string; title: string }) {
  const live = useMcmodZh(bundled ? undefined : slug);
  const name = bundled || live?.zh || title;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <h3 className="truncate text-sm font-semibold">{name}</h3>
      {name !== title && <span className="truncate text-xs text-muted-foreground">| {title}</span>}
    </div>
  );
}

export default function ResourceDownloadPage() {
  const { installedMods, installedVersions } = useLauncherStore();
  const [activeTab, setActiveTab] = useState<ResourceType>('mod');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [category, setCategory] = useState('all');
  const [gameVersion, setGameVersion] = useState('all');
  const [loader, setLoader] = useState('all');

  const [projects, setProjects] = useState<NormProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<NormProject | null>(null);

  const [gameVersionTags, setGameVersionTags] = useState<string[]>([]);
  const [wikiZh, setWikiZh] = useState<Record<string, string>>({});

  const abortRef = useRef<AbortController | null>(null);

  // 中文译名大库（懒加载）
  useEffect(() => {
    let alive = true;
    import('@/data/wikiZh.json')
      .then((m) => { if (alive) setWikiZh((m as { default?: Record<string, string> }).default || {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // 正式版 MC 版本标签（来自 Modrinth 镜像，更快）
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    (async () => {
      for (const base of ['https://mod.mcimirror.top/modrinth/v2', 'https://api.modrinth.com/v2']) {
        try {
          const data = await (await fetch(`${base}/tag/game_version`, { signal: ctrl.signal })).json() as
            Array<{ version: string; version_type: string }>;
          if (alive) setGameVersionTags(data.filter((v) => v.version_type === 'release').map((v) => v.version));
          return;
        } catch { /* next */ }
      }
    })();
    return () => { alive = false; ctrl.abort(); };
  }, []);

  // 关键词防抖
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), 400);
    return () => clearTimeout(t);
  }, [keyword]);

  const load = useCallback(async (
    append: boolean, off: number, signalOnly?: AbortController,
  ) => {
    if (append) setLoadingMore(true); else setLoading(true);
    abortRef.current?.abort();
    const ctrl = signalOnly || new AbortController();
    abortRef.current = ctrl;
    try {
      // 中文关键词 -> slug（提升 Modrinth 命中率）
      let kw = debouncedKeyword;
      if (kw && /[\u4e00-\u9fa5]/.test(kw)) {
        const slug = findZhSlug(wikiZh, MODRINTH_ZH_MAP, kw);
        if (slug) kw = slug;
      }
      const r = await browseBoth(activeTab, {
        keyword: kw, category, gameVersion: gameVersion === 'all' ? '' : gameVersion,
        loader: loader === 'all' ? '' : loader, offset: off, pageSize: PAGE_SIZE,
      }, ctrl.signal);
      if (append) setProjects((p) => [...p, ...r.projects]);
      else setProjects(r.projects);
      setTotal(r.total);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      if (!append) { setProjects([]); toast.error('资源加载失败，请检查网络'); }
    } finally {
      if (abortRef.current === ctrl) { setLoading(false); setLoadingMore(false); }
    }
  }, [activeTab, debouncedKeyword, category, gameVersion, loader, wikiZh]);

  // 筛选变化重新加载
  useEffect(() => {
    setOffset(0);
    load(false, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, debouncedKeyword, category, gameVersion, loader, load]);

  const loadMore = () => {
    const next = offset + PAGE_SIZE;
    setOffset(next);
    load(true, next);
  };

  const currentCategories = CATEGORY_FILTERS[activeTab];
  const currentLoaders = LOADERS[activeTab];

  const showDetail = (p: NormProject) => setDetail(p);

  // 详情全屏
  if (detail) {
    return <ResourceDetail type={activeTab} project={detail} onBack={() => setDetail(null)} />;
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">资源下载</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Modrinth + CurseForge 双源，搜索并安装 Mod、整合包、数据包、资源包、光影包
        </p>
      </div>

      {/* 板块 Tabs */}
      <div className="grid grid-cols-5 w-full max-w-xl rounded-lg bg-muted p-1">
        {RESOURCE_TABS.map((t) => {
          const on = t.key === activeTab;
          return (
            <button key={t.key}
              onClick={() => {
                setActiveTab(t.key); setCategory('all');
                setLoader('all'); setGameVersion('all');
              }}
              className="relative inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium">
              {on && <motion.span layoutId="res-tab"
                className="absolute inset-0 rounded-md bg-background shadow"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              <span className={`relative z-10 ${on ? 'text-foreground' : 'text-muted-foreground'}`}>{t.label}</span>
            </button>
          );
        })}
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={keyword} onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索资源（支持中文）…" className="pl-9 pr-9" />
            {keyword && (
              <button onClick={() => setKeyword('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {currentCategories.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <SearchableSelect className="w-[130px]" value={gameVersion} onChange={setGameVersion}
              options={[{ value: 'all', label: '全部版本' }, ...gameVersionTags.map((v) => ({ value: v, label: v }))]} />
            {currentLoaders.length > 0 && (
              <Select value={loader} onValueChange={setLoader}>
                <SelectTrigger className="h-9 w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部加载器</SelectItem>
                  {currentLoaders.map((l) => (
                    <SelectItem key={l} value={l}>{LOADER_LABEL[l] || l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </Card>

      <div className="space-y-2">
        {loading ? (
          <Card className="p-8 text-center text-muted-foreground">
            <Loader2 className="mx-auto mb-2 size-6 animate-spin" />正在加载资源…
          </Card>
        ) : projects.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">未找到匹配的资源</Card>
        ) : (
          <>
            <AnimatePresence mode="popLayout">
              {projects.map((p, index) => {
                const isInstalled = installedMods.some((m) => m.id === p.id || m.slug === p.slug);
                const zh = resolveModZh(wikiZh, MODRINTH_ZH_MAP, p.slug);
                const loaders = p.categories.filter((c) => currentLoaders.includes(c.toLowerCase()));
                const cats = p.categories.filter((c) => !currentLoaders.includes(c.toLowerCase())).slice(0, 2);
                return (
                  <motion.div key={`${p.source}-${p.id}`} layout
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    transition={{ delay: Math.min(index * 0.015, 0.15), duration: 0.2 }}>
                    <Card className="cursor-pointer overflow-hidden transition-shadow hover:shadow-md"
                      onClick={() => showDetail(p)}>
                      <div className="flex items-start gap-3 p-3.5">
                        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                          {p.iconUrl
                            ? <img src={p.iconUrl} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                            : <Package className="size-5 text-muted-foreground" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <CardZhName slug={p.slug} bundled={zh.name} title={p.title} />
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {zh.desc || p.description}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {loaders.slice(0, 3).map((l) => (
                              <Badge key={l} className="px-1.5 py-0 text-[10px]">{LOADER_LABEL[l.toLowerCase()] || l}</Badge>
                            ))}
                            {cats.map((c) => (
                              <Badge key={c} variant="secondary" className="px-1.5 py-0 text-[10px]">{c}</Badge>
                            ))}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1"><Download className="size-3" />{fmtNum(p.downloads)}</span>
                            <span className="inline-flex items-center gap-1"><Clock className="size-3" />{fmtDate(p.dateModified)}</span>
                            <span className={p.source === 'curseforge' ? 'text-orange-500' : 'text-[#1bd96a]'}>
                              ● {p.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}
                            </span>
                          </div>
                        </div>
                        <Button size="sm" variant={isInstalled ? 'ghost' : 'default'}
                          onClick={(e) => { e.stopPropagation(); showDetail(p); }}
                          className="h-8 shrink-0 gap-1">
                          {isInstalled ? <Check className="size-3.5" /> : <Download className="size-3.5" />}
                          {isInstalled ? '已下载' : '下载'}
                        </Button>
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {projects.length < total && (
              <div className="pt-2 text-center">
                <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="gap-2">
                  {loadingMore ? <Loader2 className="size-4 animate-spin" /> : <ChevronDown className="size-4" />}
                  {loadingMore ? '加载中…' : `加载更多 (${projects.length}/${fmtNum(total)})`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
