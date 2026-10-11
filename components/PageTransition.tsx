import { AnimatePresence, motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import { useRef, useLayoutEffect } from "react";

const elementChildren = (el: Element) => Array.from(el.children).filter((n): n is HTMLElement => n.nodeType === 1);

// 新页面挂载后，让页面内不同的块按其“在屏幕上的方位”分别从左/右/上/下进场，
// 逐块错开，使用带过冲的回弹曲线（越过目标再回来），更 Q 弹。
function playDirectionalEnter(main: HTMLElement) {
  const reduce = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // 沿“单子节点”链向下，找到真正容纳多个板块的容器
  let container: HTMLElement = main;
  for (let d = 0; d < 4; d++) {
    const kids = elementChildren(container);
    if (kids.length !== 1) break;
    container = kids[0];
  }
  let blocks = elementChildren(container).filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 12 && r.height > 12;
  });
  if (!blocks.length) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const animate = blocks.slice(0, 16);
  blocks.slice(16).forEach((b) => { b.style.opacity = "1"; });

  animate.forEach((b, i) => {
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let x = 0;
    let y = 0;
    if (r.width > vw * 0.6) {
      y = cy < vh * 0.35 ? -64 : 64; // 通栏块：按纵向位置从上/下进入
    } else if (cx < vw * 0.38) {
      x = -78; // 左侧内容从左进
    } else if (cx > vw * 0.62) {
      x = 78; // 右侧内容从右进
    } else {
      y = cy < vh * 0.3 ? -58 : 58; // 中部按上/下
    }
    if (reduce) { b.style.opacity = "1"; return; }
    const delay = Math.min(i, 10) * 52;
    const anim = b.animate(
      [
        { opacity: 0, transform: `translate3d(${x}px, ${y}px, 0) scale(0.94)` },
        { opacity: 1, transform: "translate3d(0, 0, 0) scale(1.025)", offset: 0.7 },
        { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
      ],
      { duration: 640, delay, easing: "cubic-bezier(0.3, 1.45, 0.45, 1)", fill: "both" }
    );
    anim.onfinish = () => { b.style.transform = ""; b.style.opacity = ""; };
  });
}

// 切换时整体仅做淡入淡出（不再整页朝一个方向滑动）；页面内各元素由 playDirectionalEnter
// 按方位分方向、带过冲回弹地进场。
export default function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (mainRef.current) playDirectionalEnter(mainRef.current);
  }, [location.pathname]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.main
        key={location.pathname}
        ref={mainRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.16, ease: "easeIn" } }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className={className}
      >
        {children}
      </motion.main>
    </AnimatePresence>
  );
}
