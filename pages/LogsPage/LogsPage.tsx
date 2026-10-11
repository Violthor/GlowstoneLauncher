import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Trash2, ScrollText, Terminal, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLauncherStore } from '@/hooks/useLauncherStore';
import { toast } from 'sonner';
import type { ILogEntry } from '@/data/launcher';

export default function LogsPage() {
  const { logs, clearLogs } = useLauncherStore();
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [filterSource, setFilterSource] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  const filteredLogs = logs.filter((log) => {
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    if (filterSource !== 'all' && log.source !== filterSource) return false;
    return true;
  });

  useEffect(() => {
    if (!autoScroll || !containerRef.current) return;
    if (userScrolled) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [logs, autoScroll, userScrolled]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 30;
    setUserScrolled(!atBottom);
  };

  const handleClear = () => { clearLogs(); toast.info('日志已清空'); };

  const getLogColor = (level: ILogEntry['level']) => {
    switch (level) {
      case 'INFO': return 'text-foreground';
      case 'WARN': return 'text-amber-500 dark:text-amber-400';
      case 'ERROR': return 'text-destructive';
      default: return 'text-foreground';
    }
  };

  const getLevelBadge = (level: ILogEntry['level']) => {
    switch (level) {
      case 'INFO': return <Badge variant="secondary" className="font-mono text-xs h-5">INFO</Badge>;
      case 'WARN': return <Badge variant="outline" className="font-mono text-xs h-5 text-amber-500 border-amber-300">WARN</Badge>;
      case 'ERROR': return <Badge variant="destructive" className="font-mono text-xs h-5">ERROR</Badge>;
      default: return <Badge variant="secondary" className="font-mono text-xs h-5">{level}</Badge>;
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-5 h-full flex flex-col">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">日志</h1>
          <p className="text-muted-foreground text-sm mt-1">查看启动器和游戏运行日志，共 {logs.length} 条</p>
        </div>
        <Button variant="outline" onClick={handleClear} className="gap-2">
          <Trash2 className="size-4" />清空日志
        </Button>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="size-4" />筛选:
          </div>
          <Select value={filterLevel} onValueChange={setFilterLevel}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部级别</SelectItem>
              <SelectItem value="INFO">INFO</SelectItem>
              <SelectItem value="WARN">WARN</SelectItem>
              <SelectItem value="ERROR">ERROR</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部来源</SelectItem>
              <SelectItem value="launcher">启动器</SelectItem>
              <SelectItem value="game">游戏</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <label className="flex items-center gap-2 cursor-pointer text-muted-foreground">
              <input type="checkbox" checked={autoScroll}
                onChange={(e) => { setAutoScroll(e.target.checked); setUserScrolled(false); }}
                className="rounded border-input" />
              自动滚动
            </label>
          </div>
        </CardContent>
      </Card>

      <Card className="flex-1 flex flex-col min-h-[400px]">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="size-5 text-muted-foreground" />
            <CardTitle className="text-base">日志输出</CardTitle>
            <Badge variant="outline" className="ml-auto font-mono text-xs">{filteredLogs.length} 条</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <div ref={containerRef} onScroll={handleScroll}
            className="h-[500px] overflow-y-auto font-mono text-sm bg-[hsl(220_20%_98%)] dark:bg-[hsl(220_20%_8%)] p-4 text-xs leading-relaxed">
            {filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <ScrollText className="size-8 mb-2 opacity-50" />
                <p className="text-sm">暂无日志</p>
              </div>
            ) : (
              filteredLogs.map((log, index) => (
                <motion.div key={`${log.timestamp}-${index}`}
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.15 }}
                  className="flex items-start gap-3 py-0.5 border-b border-border/20 last:border-0">
                  <span className="text-muted-foreground shrink-0 w-[64px]">{log.timestamp}</span>
                  <span className="shrink-0 w-[52px]">{getLevelBadge(log.level)}</span>
                  <span className="text-muted-foreground shrink-0 w-[60px]">{log.source === 'launcher' ? '启动器' : '游戏'}</span>
                  <span className={`flex-1 break-all ${getLogColor(log.level)}`}>{log.message}</span>
                </motion.div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
