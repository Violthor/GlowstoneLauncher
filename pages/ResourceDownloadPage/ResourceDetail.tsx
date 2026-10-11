import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Heart, ExternalLink, Copy, Download, ChevronLeft, Loader2, Globe,
  Clock, Package, FolderOpen, Check, AlertTriangle, Image as ImageIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit-lite';
import { useLauncherStore } from '@/hooks/useLauncherStore';
import { isMobileHost } from '@/mobile/bridge';
import { enqueueDownload } from '@/hooks/useDownloadQueue';
import { MODRINTH_ZH_MAP } from '@/data/launcher';
import { resolveModZh, findZhSlug } from '@/data/modZh';
import { useMcmodZh } from './useMcmodZh';
import {
  ResourceType, NormProject, NormFile, SourceName,
  getModrinthFiles, getCurseforgeFiles, getModrinthProject,
  getModrinthProjects, getCurseforgeProjects, getCurseforgeProject,
  getModrinthFileById, getCurseforgeFileById,
} from './resourceApi';

type DetailTab = 'desc' | 'versions' | 'gallery';

interface ExtraDetail {
  body?: string;
  gallery: string[];
  screenshots: string[];
  links: Array<{ label: string; url: string }>;
  clientSide?: string;
  serverSide?: string;
  license?: string;
  published: number;
}

function getAPI() {
  return (window as unknown as {
    electronAPI?: {
      selectFolder: () => Promise<{ success: boolean; path?: string; name?: string }>;
      defaultDownloadDir: () => Promise<{ success: boolean; path?: string }>;
      defaultMcDir?: () => Promise<{ success: boolean; path?: string }>;
      resolveTargetDir?: (a: { root: string; versionId: string; isolated: boolean; kind: string }) =>
        Promise<{ success: boolean; path?: string; global?: boolean; error?: string }>;
      downloadFile: (url: string, dir: string, name: string, taskId?: string) =>
        Promise<{ success: boolean; savePath?: string; error?: string }>;
      importModpack?: (a: { srcPath: string; parentDir: string; name: string }) =>
        Promise<{ success: boolean; gameDir?: string; loader?: string; name?: string; error?: string }>;
      installCfModpack?: (a: { srcPath: string; parentDir: string; name: string; taskId?: string }) =>
        Promise<{ success: boolean; gameDir?: string; loader?: string; name?: string; error?: string }>;
      openFolder?: (p: string) => void;
    }
  }).electronAPI ?? null;
}

const fmtNum = (n: number) => {
  if (n >= 100000000) return `${(n / 100000000).toFixed(2)} 亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
  return String(n);
};
const fmtDate = (ms: number) => {
  if (!ms) return '未知';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtSize = (n: number) => {
  if (!n) return '';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1024).toFixed(1) + ' KB';
};
const openUrl = (u?: string) => {
  if (!u) return;
  (window as unknown as { electronAPI?: { openExternal?: (u: string) => void } })
    .electronAPI?.openExternal?.(u);
};

// 内置轻量 markdown 渲染（支持标题/列表/链接/图片/粗体/斜体/代码块/换行），自动剥离危险标签
// Modrinth/CurseForge 正文是 markdown，但常混入 <iframe>/<br>/<img>/<a> 等原生 HTML。
// 先安全转成 markdown（视频/图片/链接保留，其余标签剥离），再统一转义，避免原始标签直接外露。
function htmlToMarkdown(input: string): string {
  let s = String(input || '');
  // 视频嵌入（多为 YouTube）：不在应用内嵌入第三方页面，转成可点击链接
  s = s.replace(/<iframe[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:[\s\S]*?<\/iframe>)?/gi, (_m, src) => {
    let url = String(src);
    let label = '视频介绍';
    const yt = url.match(/(?:youtube\.com\/embed\/|youtu\.be\/)([\w-]+)/);
    if (yt) { url = 'https://www.youtube.com/watch?v=' + yt[1]; label = 'YouTube 视频'; }
    return `\n\n[▶ ${label}](${url})\n\n`;
  });
  // 超链接（开闭配对）
  s = s.replace(/<a[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  // 图片
  s = s.replace(/<img[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, '\n\n![]($1)\n\n');
  // 换行 / 分隔线
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');
  // 其余所有 HTML 标签：剥离（保留文字内容）
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  // 规范化：块级标题后若只有单换行，补一个空行，确保后续内容被正确分段包裹（否则长段落会漏出 <p>）
  s = s.replace(/(^|\n)(#{1,6}[^\n]+)\n(?!\n)/g, '$1$2\n\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s;
}

function renderMarkdownSafe(md: string): string {
  try {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let html = esc(htmlToMarkdown(md));
    // 代码块 ```...```
    html = html.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c}</code></pre>`);
    // 行内代码 `...`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 标题
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
    // 图片 ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" style="max-width:100%;border-radius:6px;margin:4px 0" />');
    // 链接 [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    // 粗体 **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 斜体 *text*
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // 无序列表
    html = html.replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
    // 有序列表
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
    // 水平线
    html = html.replace(/^---+$/gm, '<hr/>');
    // 段落（空行分隔）
    html = html.replace(/\n{2,}/g, '</p><p>');
    html = `<p>${html}</p>`;
    // 换行
    html = html.replace(/\n/g, '<br/>');
    return html;
  } catch {
    return md.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// 画廊单图：固定 16:9 宽高比框；直接走主进程代理下载（绕过 CORS/国内网络限制），失败显示占位。
// 把「已渲染的 HTML」中的文本翻译为中文，完整保留标签/图片/代码结构。
// 链接：保留 href、仅翻译其文字；img/code/pre 整体保护。逐块、逐子段翻译（每段一次请求，绝不串行错位）。
async function translateHtmlString(
  html: string,
  api: { translateText?: (t: string) => Promise<{ success: boolean; text?: string }> },
): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = Array.from(doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th'));
  interface Unit {
    el: HTMLElement;
    statics: Array<{ token: string; html: string }>;
    links: Array<{ token: string; href: string; text: string }>;
    segs: string[];
  }
  const units: Unit[] = [];
  blocks.forEach((el) => {
    const statics: Unit['statics'] = [];
    const links: Unit['links'] = [];
    // 链接：记录 href/文字，整体替换为 token（文字稍后单独翻译）
    el.querySelectorAll('a').forEach((node) => {
      const token = `zln${links.length}lnz`;
      links.push({ token, href: node.getAttribute('href') || '', text: node.textContent || '' });
      node.replaceWith(doc.createTextNode(token));
    });
    // img/code/pre：整体保护，不翻译
    el.querySelectorAll('code,pre,img').forEach((node) => {
      const token = `zph${statics.length}phz`;
      statics.push({ token, html: (node as HTMLElement).outerHTML });
      node.replaceWith(doc.createTextNode(token));
    });
    const text = el.textContent || '';
    if (!text.trim()) return;
    // 长块按句子边界切成 ≤380 的子段，避免主进程二次切分导致回填错位
    const segs = text.length <= 380 ? [text] : (text.match(/[\s\S]{1,380}(?:[.!?。！？]|\s|$)/g) || [text]);
    units.push({ el: el as HTMLElement, statics, links, segs: segs.map((s) => s.trim()) });
  });
  if (units.length === 0) return html;
  const tr = async (s: string): Promise<string> => {
    try { const r = await api.translateText?.(s); if (r?.success && r.text) return r.text; } catch { /* 保留原文 */ }
    return s;
  };
  for (const u of units) {
    const outSegs: string[] = [];
    for (const s of u.segs) outSegs.push(await tr(s));
    let t = outSegs.join('');
    // 链接：翻译文字、重建 a（保留 href）
    for (const l of u.links) {
      const lt = await tr(l.text);
      const safeHref = l.href.replace(/"/g, '%22');
      t = t.split(l.token).join(`<a href="${safeHref}" target="_blank" rel="noreferrer">${lt}</a>`);
    }
    // 静态元素还原
    u.statics.forEach((st) => { t = t.split(st.token).join(st.html); });
    u.el.innerHTML = t;
  }
  return doc.body.innerHTML;
}

function GalleryCard({ url }: { url: string }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false); setSrc('');
    (window as unknown as { electronAPI?: { proxyImage?: (u: string) => Promise<{ success: boolean; dataUrl?: string }> } })
      .electronAPI?.proxyImage?.(url)
      .then((r) => { if (alive && r?.success && r.dataUrl) setSrc(r.dataUrl); else if (alive) setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [url, retry]);

  return (
    <div className="group relative block aspect-video overflow-hidden rounded-lg border border-border/60 bg-muted/40">
      {!failed && src && (
        <a href={url} target="_blank" rel="noreferrer" className="absolute inset-0 block hover:opacity-95">
          <img
            src={src} alt="" loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </a>
      )}
      {!failed && !src && (
        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
          <Loader2 className="size-4 animate-spin mr-1.5" />加载中…
        </span>
      )}
      {failed && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground px-2">
          <ImageIcon className="size-7" />
          <span className="text-xs text-center">图片加载失败</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setRetry((n) => n + 1)}
              className="text-xs px-2 py-0.5 rounded border border-border hover:bg-accent cursor-pointer">重试</button>
            <a href={url} target="_blank" rel="noreferrer"
              className="text-xs px-2 py-0.5 rounded border border-border hover:bg-accent">打开原图</a>
          </span>
        </span>
      )}
    </div>
  );
}

// 依赖项（解析出项目信息后）
interface ResolvedDep {
  key: string;
  kind: 'required' | 'optional';
  projectId?: string;
  fileId?: string;
  title: string;
  installed: boolean;
}

export default function ResourceDetail({
  type, project: initial, onBack,
}: {
  type: ResourceType;
  project: NormProject;
  onBack: () => void;
}) {
  const isMobile = isMobileHost();
  const {
    installedMods, addInstalledVersion,
    appendLog, settings,
  } = useLauncherStore();
  const [project, setProject] = useState<NormProject>(initial);
  const [tab, setTab] = useState<DetailTab>('desc');
  const [files, setFiles] = useState<NormFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [mcFilter, setMcFilter] = useState('all');
  const [extra, setExtra] = useState<ExtraDetail | null>(null);
  const [selectedFile, setSelectedFile] = useState<NormFile | null>(null);
  const [deps, setDeps] = useState<ResolvedDep[]>([]);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [translatedHtml, setTranslatedHtml] = useState<string>('');
  const [translating, setTranslating] = useState(false);
  // 原文渲染后的 HTML（先把混入的原生 HTML 转成 markdown，再统一渲染）
  const originalHtml = useMemo(
    () => (extra?.body ? renderMarkdownSafe(htmlToMarkdown(extra.body)) : ''),
    [extra?.body],
  );

  // 英文描述自动翻译为中文：在已渲染 HTML 上只翻译文本节点、保留标签结构（失败静默保留原文）。
  // 用单调递增的请求 id 处理「详情资源自动切换」：旧请求结果一律丢弃，最终只采用最新资源的译文。
  const translateReqRef = useRef(0);
  useEffect(() => {
    const body = extra?.body;
    if (!body || !originalHtml) return;
    const cjk = (body.match(/[一-鿿]/g) || []).length;
    const letters = (body.match(/[A-Za-z]/g) || []).length;
    if (letters < 20) return;                     // 英文太少，无需翻译
    if (cjk > 20 && cjk >= letters * 0.3) return; // 已有较多中文，不重复翻译
    const myId = ++translateReqRef.current;
    setTranslatedHtml('');   // 新资源先显示原文
    let alive = true;
    (async () => {
      const api = (window as unknown as { electronAPI?: { translateText?: (t: string) => Promise<{ success: boolean; text?: string }> } }).electronAPI;
      try {
        setTranslating(true);
        const out = await translateHtmlString(originalHtml, api || {});
        if (alive && myId === translateReqRef.current) setTranslatedHtml(out);
      } catch { /* 保留原文 */ } finally {
        if (alive && myId === translateReqRef.current) setTranslating(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extra?.body, originalHtml]);

  // 下载位置：仅手动选择，不再按版本自动装入 mods/resourcepacks/shaderpacks 等目录
  const [installPath, setInstallPath] = useState('');
  const [installLabel, setInstallLabel] = useState('');

  const abortFiles = useRef<AbortController | null>(null);

  const loaderAgnostic = type !== 'mod' && type !== 'modpack';
  // 该类型可选加载器
  const loaderOptions = useMemo(() => {
    if (type === 'mod') return ['fabric', 'forge', 'neoforge', 'quilt', 'liteloader'];
    if (type === 'shader') return ['iris', 'optifine', 'canvas'];
    if (type === 'modpack') return ['forge', 'fabric', 'neoforge', 'quilt'];
    return [];
  }, [type]);
  const [loaderFilter, setLoaderFilter] = useState('all');

  // 中文译名大库（懒加载，与列表页一致）
  const [wikiZh, setWikiZh] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    import('@/data/wikiZh.json')
      .then((m) => { if (alive) setWikiZh((m as { default?: Record<string, string> }).default || {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const zh = useMemo(
    () => resolveModZh(wikiZh, MODRINTH_ZH_MAP, project.slug),
    [wikiZh, project.slug],
  );
  // MC百科实时译名（权威、最新）；存在时优先于内置静态库
  const liveZh = useMcmodZh(project.slug);
  const zhName = liveZh?.zh || zh.name || '';

  // 收集文件中出现过的 MC 版本（chips）
  const mcChips = useMemo(() => {
    const set = new Set<string>();
    files.forEach((f) => f.gameVersions.forEach((g) => set.add(g)));
    return [...set]
      .filter((g) => /^\d+(\.\d+)*$/.test(g))
      .sort((a, b) => {
        const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
        const n = Math.max(pa.length, pb.length);
        for (let i = 0; i < n; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return y - x; }
        return 0;
      });
  }, [files]);

  // 按 MC + 加载器过滤后展示的文件
  const visibleFiles = useMemo(() => {
    let list = files;
    if (mcFilter !== 'all') list = list.filter((f) => f.gameVersions.includes(mcFilter));
    return list;
  }, [files, mcFilter]);

  // 加载文件列表
  const loadFiles = useCallback(async (mc: string, loader: string) => {
    abortFiles.current?.abort();
    const ctrl = new AbortController();
    abortFiles.current = ctrl;
    setLoadingFiles(true);
    try {
      const q = { gameVersion: mc === 'all' ? '' : mc, loader: loaderAgnostic ? 'all' : loader };
      let list: NormFile[];
      if (project.source === 'modrinth') {
        list = await getModrinthFiles(project.id, q, ctrl.signal);
      } else {
        list = await getCurseforgeFiles(project.id, q, ctrl.signal);
      }
      // 排序：正式版优先、发布时间倒序
      list = list.sort((a, b) => {
        const ra = a.releaseType === 'release' ? 0 : 1, rb = b.releaseType === 'release' ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return b.datePublished - a.datePublished;
      });
      setFiles(list);
      setSelectedFile(list[0] || null);
      if (!list.length && (mc !== 'all' || loader !== 'all')) {
        toast.message('精确筛选无结果，可点“全部”查看所有版本');
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      logger.warn('load files error', String(e));
      toast.error('获取版本列表失败，请检查网络');
    } finally {
      setLoadingFiles(false);
    }
  }, [project, loaderAgnostic]);

  // 初次：拉取源项目详情（描述/画廊/链接）+ 文件
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    (async () => {
      try {
        if (initial.source === 'modrinth') {
          const p = await getModrinthProject(initial.id, ctrl.signal);
          // 额外原始字段
          const bases = ['https://mod.mcimirror.top/modrinth/v2', 'https://api.modrinth.com/v2'];
          let raw: Record<string, unknown> | null = null;
          for (const b of bases) {
            try {
              raw = await (await fetch(`${b}/project/${initial.id}`, { signal: ctrl.signal })).json();
              break;
            } catch { /* next */ }
          }
          if (!alive) return;
          setProject(p);
          const r = raw as {
            body?: string; gallery?: string[]; issues_url?: string; source_url?: string;
            wiki_url?: string; discord_url?: string; client_side?: string; server_side?: string;
            license?: { name?: string } | string; published?: string;
          } | null;
          const links: Array<{ label: string; url: string }> = [];
          if (r?.issues_url) links.push({ label: '问题反馈', url: r.issues_url });
          if (r?.source_url) links.push({ label: '源码', url: r.source_url });
          if (r?.wiki_url) links.push({ label: 'Wiki', url: r.wiki_url });
          if (r?.discord_url) links.push({ label: 'Discord', url: r.discord_url });
          setExtra({
            body: r?.body || '', gallery: (r?.gallery || []).map((g: any) => (typeof g === 'string' ? g : g?.url)).filter(Boolean), screenshots: [],
            links, clientSide: r?.client_side, serverSide: r?.server_side,
            license: typeof r?.license === 'object' ? r?.license?.name : (r?.license as string),
            published: r?.published ? Date.parse(r.published) : p.dateCreated,
          });
        } else {
          const p = await getCurseforgeProject(initial.id, ctrl.signal);
          const raw = await (await fetch(
            `https://mod.mcimirror.top/curseforge/v1/mods/${initial.id}`,
            { signal: ctrl.signal },
          )).json() as {
            data: {
              screenshots?: Array<{ url: string }>;
              links?: Record<string, string>;
              dateCreated?: string;
            }
          };
          if (!alive) return;
          setProject(p);
          const linkMap = raw.data.links || {};
          const labelMap: Record<string, string> = {
            WebsiteUrl: '官网', WikiUrl: 'Wiki', IssuesUrl: '问题反馈',
            SourceUrl: '源码', DiscordUrl: 'Discord',
          };
          const links = Object.entries(linkMap)
            .map(([k, u]) => ({ label: labelMap[k] || k, url: u as string }))
            .filter((l) => l.url);
          setExtra({
            gallery: [], links,
            screenshots: (raw.data.screenshots || []).map((s) => s.url),
            published: raw.data.dateCreated ? Date.parse(raw.data.dateCreated) : p.dateCreated,
          });
        }
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        logger.warn('detail load error', String(e));
      }
    })();
    return () => { alive = false; ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id, initial.source]);

  // 首次加载文件
  useEffect(() => {
    loadFiles('all', 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.source]);

  // 解析选中文件的依赖项目信息
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const all = selectedFile?.dependencies || [];
    const wanted = all.filter((d) => d.kind === 'required' || d.kind === 'optional');
    if (!wanted.length) { setDeps([]); return; }
    setLoadingDeps(true);
    (async () => {
      try {
        let titleMap = new Map<string, NormProject>();
        const mrIds = wanted.filter((d) => d.source === 'modrinth' && d.projectId).map((d) => d.projectId!);
        const cfIds = wanted.filter((d) => d.source === 'curseforge' && d.projectId).map((d) => d.projectId!);
        if (mrIds.length) titleMap = new Map([...titleMap, ...(await getModrinthProjects(mrIds, ctrl.signal))]);
        if (cfIds.length) titleMap = new Map([...titleMap, ...(await getCurseforgeProjects(cfIds, ctrl.signal))]);
        if (!alive) return;
        const resolved: ResolvedDep[] = wanted.map((d) => {
          const key = d.projectId || d.fileId || Math.random().toString(36);
          const info = d.projectId ? titleMap.get(d.projectId) : undefined;
          const title = info?.title || (d.fileId ? `文件 #${d.fileId}` : '未知依赖');
          const installed = info
            ? installedMods.some((m) => m.slug === info.slug || m.id === info.id)
            : false;
          return {
            key, kind: d.kind, projectId: d.projectId, fileId: d.fileId, title, installed,
          };
        });
        setDeps(resolved);
      } catch { if (alive) setDeps([]); }
      finally { if (alive) setLoadingDeps(false); }
    })();
    return () => { alive = false; ctrl.abort(); };
  }, [selectedFile, installedMods]);

  const missingRequired = deps.filter((d) => d.kind === 'required' && !d.installed);
  const optionalDeps = deps.filter((d) => d.kind === 'optional');

  // 为某个依赖解析一个兼容文件
  const resolveDepFile = useCallback(async (d: ResolvedDep): Promise<NormFile | null> => {
    const src: SourceName = d.projectId
      ? (project.source) // 跨平台依赖通常与主项目同源
      : project.source;
    const mc = mcFilter === 'all' ? (selectedFile?.gameVersions[0] || '') : mcFilter;
    const loader = loaderAgnostic ? '' : (loaderFilter !== 'all' ? loaderFilter : (selectedFile?.loaders[0] || ''));
    try {
      if (d.fileId && d.projectId) {
        if (src === 'curseforge') return await getCurseforgeFileById(d.projectId, d.fileId);
        return await getModrinthFileById(d.fileId);
      }
      if (d.projectId) {
        if (src === 'curseforge') {
          const list = await getCurseforgeFiles(d.projectId, { gameVersion: mc, loader });
          return list[0] || null;
        }
        const list = await getModrinthFiles(d.projectId, { gameVersion: mc, loader });
        return list[0] || null;
      }
    } catch { return null; }
    return null;
  }, [project.source, mcFilter, loaderFilter, loaderAgnostic, selectedFile]);

  // 下载（主文件 + 必选前置，全部保存到手动选择的文件夹）
  const startInstall = async () => {
    const api = getAPI();
    if (!selectedFile) { toast.error('没有可安装的文件'); return; }
    const file = selectedFile;

    // ---- 整合包：下载后解压为实例（手机端不支持解压安装，走普通下载只存文件） ----
    if (type === 'modpack' && !isMobile) {
      if (!api) { openUrl(file.url); return; }
      // 让用户选择安装位置（整合包解压后的父目录）
      let parentDir = installPath;
      if (!parentDir) {
        const picked = await pickFolder();
        if (!picked) { toast.error('请先选择整合包安装位置'); return; }
        parentDir = picked;
      }
      const isCf = project.source === 'curseforge';
      const handler = isCf ? api.installCfModpack : api.importModpack;
      if (!handler) { toast.error('该整合包安装需要新版组件'); return; }
      enqueueDownload(`${project.title} 整合包`, async (taskId) => {
        const stage = await api.defaultDownloadDir!();
        const stageDir = stage.success && stage.path ? stage.path : '';
        const dl = await api.downloadFile(file.url, stageDir, file.fileName, taskId);
        if (!dl.success || !dl.savePath) return { success: false, error: dl.error || '整合包下载失败' };
        const rawName = project.slug || project.title;
        const name = rawName.replace(/[\\/:*?"<>|]/g, '_').trim();
        const arg = { srcPath: dl.savePath, parentDir, name, taskId };
        const inst = await handler(arg as never);
        if (!inst.success || !inst.gameDir) return { success: false, error: inst.error || '整合包安装失败' };
        addInstalledVersion({
          id: name, versionId: name,
          loader: (inst.loader as 'vanilla' | 'forge' | 'fabric' | 'quilt' | 'neoforge') || 'fabric',
          icon: inst.loader || 'fabric', category: '下载整合包',
          description: `安装于 ${inst.gameDir}`, isFavorite: false, installTime: Date.now(),
          gameDir: inst.gameDir, minMemoryMB: 1024, maxMemoryMB: 4096, versionType: 'release',
        });
        appendLog('INFO', `整合包安装成功: ${name} -> ${inst.gameDir}`);
        return { success: true };
      });
      toast.success('已加入下载队列');
      return;
    }

    // ---- 普通资源：仅手动选择下载位置，不自动装入 mods/resourcepacks 等目录 ----
    let target = installPath;
    if (!target) {
      const picked = await pickFolder();
      if (!picked) { toast.error('请先选择下载位置'); return; }
      target = picked;
    }
    if (!api) { openUrl(file.url); return; }

    const depTasks = missingRequired;
    enqueueDownload(`${zh.name || project.title}`, async (taskId) => {
      const r = await api.downloadFile(file.url, target, file.fileName, taskId);
      if (!r.success) return { success: false, error: r.error || '下载失败' };
      // 必选前置：解析兼容文件并下载到同一个手动选择的文件夹
      for (const d of depTasks) {
        try {
          const df = await resolveDepFile(d);
          if (!df) { appendLog('WARN', `前置“${d.title}”需手动下载`); continue; }
          const dr = await api.downloadFile(df.url, target, df.fileName, taskId);
          if (dr.success) appendLog('INFO', `已下载前置：${d.title}`);
          else appendLog('WARN', `前置“${d.title}”下载失败`);
        } catch (e) {
          appendLog('WARN', `前置下载失败：${String(e)}`);
        }
      }
      return { success: true };
    });
    if (depTasks.length) {
      toast.message(`将随主文件下载 ${depTasks.length} 个前置到所选文件夹：${depTasks.map((d) => d.title).join('、')}`);
    } else {
      toast.success('已加入下载队列');
    }
  };

  const pickFolder = async (): Promise<string | null> => {
    const api = getAPI();
    if (!api) return null;
    const r = await api.selectFolder();
    if (r.success && r.path) {
      setInstallPath(r.path);
      setInstallLabel(r.name || r.path);
      return r.path;
    }
    return null;
  };

  const copyName = () => {
    const text = project.slug || project.title;
    navigator.clipboard?.writeText(text).then(() => toast.success('已复制名称'));
  };

  const banner = extra?.gallery?.[0] || extra?.screenshots?.[0] || project.iconUrl || '';
  const galleryImages = [
    ...(extra?.gallery || []),
    ...(extra?.screenshots || []),
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      {/* Hero 区 */}
      <div className="relative overflow-hidden rounded-xl border border-border/60">
        {/* 模糊背景 banner */}
        <div className="absolute inset-0">
          {banner && <img src={banner} alt="" className="h-full w-full object-cover blur-2xl scale-110 opacity-40" />}
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 to-background" />
        </div>

        <div className="relative p-5">
          <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-4" /> 返回资源列表
          </button>
          <div className="flex items-start gap-4">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
              {project.iconUrl
                ? <img src={project.iconUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                : <Package className="size-8 text-muted-foreground" />}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold truncate">
                {zhName || project.title}
                {zhName && zhName !== project.title &&
                  <span className="ml-2 text-sm font-normal text-muted-foreground">{project.title}</span>}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{zh.desc || project.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Download className="size-3" />{fmtNum(project.downloads)}</span>
                {project.follows > 0 && <span className="inline-flex items-center gap-1"><Heart className="size-3" />{fmtNum(project.follows)}</span>}
                <span className="inline-flex items-center gap-1"><Clock className="size-3" />更新于 {fmtDate(project.dateModified)}</span>
                <span className={project.source === 'curseforge' ? 'text-orange-500' : 'text-[#1bd96a]'}>
                  ● {project.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}
                </span>
              </div>
            </div>
          </div>

          {/* 操作按钮行 */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={startInstall} className="gap-1"><Download className="size-4" />下载</Button>
            <Button variant="outline" onClick={() => setFavorite((f) => !f)} className="gap-1">
              <Heart className={`size-4 ${favorite ? 'fill-red-500 text-red-500' : ''}`} />收藏
            </Button>
            <Button variant="outline" onClick={() => openUrl(project.source === 'modrinth'
              ? `https://modrinth.com/${type === 'mod' ? 'mod' : project.slug}/${project.slug}`
              : `https://www.curseforge.com/minecraft/${type === 'mod' ? 'mc-mods' : type}/${project.slug}`)}
              className="gap-1"><ExternalLink className="size-4" />打开源</Button>
            <Button variant="outline" onClick={copyName} className="gap-1"><Copy className="size-4" />复制名称</Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {/* 左侧主区 */}
        <div className="space-y-4">
          {/* Tab 切换 */}
          <div className="inline-flex rounded-lg bg-muted p-1">
            {([
              { k: 'desc', l: '描述' },
              { k: 'versions', l: '版本' },
              { k: 'gallery', l: '画廊' },
            ] as { k: DetailTab; l: string }[]).map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)}
                className={`rounded-md px-4 py-1.5 text-sm ${tab === t.k ? 'bg-background shadow' : 'text-muted-foreground'}`}>
                {t.l}
              </button>
            ))}
          </div>

          {/* 前置依赖（仅在版本/描述 tab 且有依赖时显示） */}
          {deps.length > 0 && tab !== 'gallery' && (
            <Card className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium flex items-center gap-1">
                  {loadingDeps ? <Loader2 className="size-4 animate-spin" /> : null}
                  前置依赖（{missingRequired.length} 必选，{optionalDeps.length} 可选）
                </div>
                <Button size="sm" variant="outline" onClick={startInstall} className="h-7 gap-1">
                  <Download className="size-3" />一键下载
                </Button>
              </div>
              <div className="space-y-1.5">
                {deps.map((d) => (
                  <div key={d.key} className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
                    <span className="flex items-center gap-2">
                      {d.installed ? <Check className="size-3.5 text-green-600" />
                        : d.kind === 'required' ? <AlertTriangle className="size-3.5 text-amber-600" />
                          : <Package className="size-3.5 text-muted-foreground" />}
                      {d.title}
                    </span>
                    <Badge variant={d.kind === 'required' ? 'default' : 'secondary'} className="text-[10px]">
                      {d.installed ? '已安装' : d.kind === 'required' ? '必选' : '可选'}
                    </Badge>
                  </div>
                ))}
              </div>
              {missingRequired.length > 0 &&
                <p className="mt-2 text-[11px] text-muted-foreground">缺失的必选前置将在下载时保存到你选择的同一文件夹。</p>}
            </Card>
          )}

          {/* 描述 */}
          {tab === 'desc' && (
            <Card className="p-4 text-sm leading-relaxed">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-muted-foreground">项目介绍</span>
                {extra?.body && (
                  <Button
                    variant="outline" size="sm" className="gap-1.5 h-7 text-xs"
                    disabled={translating}
                    onClick={async () => {
                      if (translatedHtml) { setTranslatedHtml(''); return; }
                      const api = (window as unknown as { electronAPI?: { translateText?: (t: string) => Promise<{ success: boolean; text?: string; error?: string }> } }).electronAPI;
                      setTranslating(true);
                      try {
                        const out = await translateHtmlString(originalHtml, api || {});
                        setTranslatedHtml(out);
                      } catch { toast.error('翻译失败，请稍后重试'); }
                      setTranslating(false);
                    }}
                  >
                    {translating ? <Loader2 className="size-3.5 animate-spin" /> : <Globe className="size-3.5" />}
                    {translatedHtml ? '查看原文' : '翻译为中文'}
                  </Button>
                )}
              </div>
              {extra?.body ? (
                <div
                  className="prose prose-sm max-w-none text-foreground/90 [&_img]:max-w-full [&_img]:rounded-lg [&_a]:text-primary [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:rounded [&_code]:text-xs [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_h1]:font-bold [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:italic"
                  dangerouslySetInnerHTML={{ __html: translatedHtml || originalHtml }}
                />
              ) : (
                <div className="space-y-2">
                  <p className="text-foreground/90">{project.description}</p>
                  {project.source === 'curseforge' && (
                    <p className="text-xs text-muted-foreground">
                      完整图文介绍请点上方“打开源”访问 CurseForge 页面。
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* 版本 */}
          {tab === 'versions' && (
            <Card className="p-4 space-y-3">
              {/* MC 版本 chips */}
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => { setMcFilter('all'); }}
                  className={`rounded-full px-3 py-1 text-xs ${mcFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  全部
                </button>
                {mcChips.map((g) => (
                  <button key={g} onClick={() => setMcFilter(g)}
                    className={`rounded-full px-3 py-1 text-xs ${mcFilter === g ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    {g}
                  </button>
                ))}
              </div>

              {loadingFiles ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground justify-center">
                  <Loader2 className="size-4 animate-spin" /> 加载文件列表...
                </div>
              ) : visibleFiles.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">该筛选条件下暂无文件</p>
              ) : (
                <div className="space-y-1.5">
                  {visibleFiles.slice(0, 60).map((f) => (
                    <div key={f.id}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${selectedFile?.id === f.id ? 'border-primary/50 bg-primary/5' : 'border-border/60'}`}
                      onClick={() => setSelectedFile(f)}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{f.name}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          {f.loaders.slice(0, 3).map((l) => <Badge key={l} className="text-[9px] px-1 py-0">{l}</Badge>)}
                          <span>{f.gameVersions.slice(0, 4).join(', ')}</span>
                          {f.releaseType !== 'release' && <span className="text-amber-600">{f.releaseType === 'beta' ? '测试版' : 'Alpha'}</span>}
                        </div>
                      </div>
                      <span className="text-muted-foreground shrink-0">{fmtSize(f.size)}</span>
                      <Button size="sm" className="h-7 shrink-0" onClick={(e) => { e.stopPropagation(); setSelectedFile(f); void startInstall(); }}>
                        下载
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* 画廊 */}
          {tab === 'gallery' && (
            <Card className="p-4">
              {galleryImages.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                  <ImageIcon className="size-8" />
                  <p className="text-sm">该项目暂无画廊图片</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {galleryImages.map((u, i) => (
                    <GalleryCard key={i} url={u} />
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>

        {/* 右侧信息栏 */}
        <div className="space-y-3">
          <Card className="p-3 space-y-3 text-xs">
            <div>
              <div className="mb-1.5 text-muted-foreground">分类</div>
              <div className="flex flex-wrap gap-1">
                {project.categories.slice(0, 8).map((c) => (
                  <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                ))}
              </div>
            </div>

            {(extra?.links.length || 0) > 0 && (
              <div>
                <div className="mb-1.5 text-muted-foreground">链接</div>
                <div className="space-y-1">
                  {extra!.links.map((l) => (
                    <button key={l.url} onClick={() => openUrl(l.url)}
                      className="block text-primary hover:underline">{l.label}</button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-1.5 text-muted-foreground">详情</div>
              <dl className="space-y-1">
                <Row k="类型" v={typeLabel(type)} />
                <Row k="下载量" v={fmtNum(project.downloads)} />
                {project.follows > 0 && <Row k="关注数" v={fmtNum(project.follows)} />}
                <Row k="创建" v={fmtDate(extra?.published || project.dateCreated)} />
                <Row k="更新" v={fmtDate(project.dateModified)} />
                {extra?.clientSide && <Row k="客户端" v={sideLabel(extra.clientSide)} />}
                {extra?.serverSide && <Row k="服务端" v={sideLabel(extra.serverSide)} />}
              </dl>
            </div>

            {extra?.license && (
              <div>
                <div className="mb-1 text-muted-foreground">许可证</div>
                <div>{extra.license}</div>
              </div>
            )}
          </Card>

          {/* 下载位置（所有类型均手动选择，包括整合包安装目录） */}
          <Card className="p-3 space-y-2 text-xs">
            <Label className="text-xs">{type === 'modpack' ? '安装位置' : '下载位置'}</Label>
            <div className="flex gap-1">
              <Input value={installLabel || installPath} readOnly placeholder="点击右侧选择文件夹" className="h-8 text-[11px]" />
              <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={pickFolder}>
                <FolderOpen className="size-3.5" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {type === 'modpack' ? '整合包将解压安装为一个独立版本实例，存放到所选文件夹下。' : '文件将按原名保存到所选文件夹，不会自动放入游戏目录。'}
            </p>
          </Card>
        </div>
      </div>
    </motion.div>
  );
}

function isAbs(p: string): boolean {
  return /^([a-zA-Z]:[\\/]|[\\/])/.test(p);
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
function typeLabel(t: ResourceType): string {
  return ({ mod: 'Mod', modpack: '整合包', datapack: '数据包', resourcepack: '资源包', shader: '光影包' } as Record<ResourceType, string>)[t];
}
function sideLabel(s: string): string {
  return ({ required: '必需', optional: '可选', unsupported: '不支持', unknown: '未知' } as Record<string, string>)[s] || s;
}
