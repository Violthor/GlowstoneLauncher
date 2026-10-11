import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy as CopyIcon } from 'lucide-react';

declare global {
  interface Window {
    electronAPI?: {
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizeChange: (cb: (isMax: boolean) => void) => () => void;
    };
  }
}

export default function TitleBar() {
  // 仅桌面端显示窗口控制按钮；手机 WebView（isElectron !== true）隐藏整条标题栏
  const isDesktop = (window as unknown as { electronAPI?: { isElectron?: boolean } })?.electronAPI?.isElectron === true;
  const [isMaximized, setIsMaximized] = useState(false);
  const api = window.electronAPI;

  if (!isDesktop) return null;

  useEffect(() => {
    if (!api) return;
    api.isMaximized().then(setIsMaximized);
    const unsub = api.onMaximizeChange(setIsMaximized);
    return unsub;
  }, [api]);

  return (
    <div
      className="flex items-center justify-end h-9 select-none shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => api?.minimizeWindow()}
          className="h-full w-11 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Minus className="size-4" />
        </button>
        <button
          onClick={() => api?.maximizeWindow()}
          className="h-full w-11 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          {isMaximized ? <CopyIcon className="size-3.5" /> : <Square className="size-3.5" />}
        </button>
        <button
          onClick={() => api?.closeWindow()}
          className="h-full w-11 flex items-center justify-center text-muted-foreground hover:bg-red-500 hover:text-white transition-colors rounded-tr-xl"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
