import { useState } from 'react';
import { ShieldQuestion, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  LICENSE_TITLE, LICENSE_VERSION, LICENSE_HOLDER, LICENSE_SECTIONS,
} from '@/data/licenseText';
import { useLauncherStore } from '@/hooks/useLauncherStore';

interface LicenseGateProps {
  onAgree: () => void;
}

// 每次启动的协议门：启动器主体在后面正常挂载、透过半透明遮罩可见；协议以居中浮层显示。
// 浮层配色跟随当前主题（浅色主题为白底深字，深色主题为深底浅字），不再强制深色。
// 必须勾选“已阅读”才能同意；点不同意直接退出启动器。
export default function LicenseGate({ onAgree }: LicenseGateProps) {
  const [read, setRead] = useState(false);
  const { settings } = useLauncherStore();
  const isDark = settings.theme !== 'light';

  const quit = () => {
    const api = (window as unknown as { electronAPI?: { appQuit?: () => void } }).electronAPI;
    if (api?.appQuit) api.appQuit();
    else window.close();
  };

  const cardCls = isDark
    ? 'bg-[#12161f]/95 border-white/10 text-white'
    : 'bg-white/95 border-slate-200 text-slate-900 shadow-2xl';
  const dividerCls = isDark ? 'border-white/10' : 'border-slate-200';
  const titleCls = isDark ? 'text-white' : 'text-slate-900';
  const subCls = isDark ? 'text-slate-400' : 'text-slate-500';
  const sectionTitleCls = isDark ? 'text-white' : 'text-slate-900';
  const bodyCls = isDark ? 'text-slate-300' : 'text-slate-600';
  const checkTextCls = isDark ? 'text-slate-200' : 'text-slate-700';
  const quitCls = isDark
    ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10'
    : 'text-red-600 hover:text-red-700 hover:bg-red-500/10';

  return (
    <div className={isDark ? 'dark' : ''}>
      <div
        className={`fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 bg-black/55 backdrop-blur-[3px] ${isDark ? 'dark' : ''}`}
      >
        <Card className={`w-full max-w-2xl max-h-[94vh] flex flex-col overflow-hidden shadow-2xl border ${cardCls}`}>
          <div className={`px-6 pt-5 pb-4 border-b ${dividerCls} flex items-center gap-3`}>
            <div className="size-11 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <ShieldQuestion className="size-6 text-primary" />
            </div>
            <div className="min-w-0">
              <div className={`font-bold text-lg leading-tight flex items-center gap-1.5 ${titleCls}`}>
                <FileText className="size-4 text-primary" />{LICENSE_TITLE}
              </div>
              <div className={`text-xs mt-0.5 ${subCls}`}>
                {LICENSE_VERSION}　·　著作权人：{LICENSE_HOLDER}
              </div>
            </div>
          </div>

          <div className={`flex-1 overflow-y-auto px-6 py-4 space-y-4 text-sm ${isDark ? 'dark' : ''}`}>
            {LICENSE_SECTIONS.map((s) => (
              <div key={s.h} className="space-y-1.5">
                <div className={`font-semibold ${sectionTitleCls}`}>{s.h}</div>
                {s.p.map((t, i) => (
                  <p key={i} className={`leading-relaxed ${bodyCls}`}>{t}</p>
                ))}
              </div>
            ))}
          </div>

          <div className={`px-6 py-4 border-t ${dividerCls} space-y-3`}>
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <Checkbox checked={read} onCheckedChange={(v) => setRead(v === true)} id="read-eula" />
              <span className={`text-sm ${checkTextCls}`}>我已阅读并理解上述协议内容</span>
            </label>
            <div className="flex items-center justify-between gap-3">
              <Button variant="ghost" className={quitCls} onClick={quit}>
                不同意并退出
              </Button>
              <Button className="gap-1.5" disabled={!read} onClick={onAgree}>
                同意并继续
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
