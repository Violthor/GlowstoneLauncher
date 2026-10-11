import { Heart } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import devLiuliu from '@/assets/about/dev-liuliu.jpg';
import devUtie from '@/assets/about/dev-utie.jpg';
import mcwiki from '@/assets/about/credit-mcwiki.png';
import easytier from '@/assets/about/credit-easytier.png';
import z0z0r4 from '@/assets/about/credit-z0z0r4.jpg';
import skin3d from '@/assets/about/credit-skin3d.jpg';

const openLink = (u: string) => {
  const api = (window as unknown as { electronAPI?: { openExternal?: (x: string) => void } }).electronAPI;
  if (api?.openExternal) api.openExternal(u);
  else window.open(u, '_blank');
};

// 圆形头像：图片自动裁剪为圆形，干净背景
function Avatar({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="size-12 rounded-full overflow-hidden bg-muted flex items-center justify-center shrink-0 ring-2 ring-white/10">
      <img src={src} alt={alt} className="w-full h-full object-cover" />
    </div>
  );
}

// 开发者赞助卡片：圆形头像 + 名字 + 黄色按钮
function SponsorCard({
  name, link, avatar,
}: { name: string; link: string; avatar: React.ReactNode }) {
  return (
    <Card className="p-5 flex flex-col gap-4 bg-card/60 backdrop-blur">
      <div className="flex items-center gap-3">
        {avatar}
        <span className="text-lg font-bold">{name}</span>
      </div>
      <Button
        className="w-full gap-1.5 bg-amber-500 hover:bg-amber-400 text-amber-950 font-semibold"
        onClick={() => openLink(link)}
      >
        <Heart className="size-4 fill-current" /> 赞助 {name}
      </Button>
    </Card>
  );
}

// 感谢卡片：圆形头像 + 名字 + 贡献描述
function CreditCard({ avatar, name, contrib }: { avatar: React.ReactNode; name: string; contrib: string }) {
  return (
    <Card className="p-5 flex flex-col gap-3 bg-card/60 backdrop-blur">
      <div className="flex items-center gap-3">
        {avatar}
        <span className="text-base font-semibold">{name}</span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{contrib}</p>
    </Card>
  );
}

export default function AboutPage() {
  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">关于</h1>
        <p className="text-sm text-muted-foreground mt-1">认识 Glowstone Launcher 的开发者，以及为它提供帮助的朋友们</p>
      </div>

      {/* 开发者 */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Glowstone Launcher 开发者</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SponsorCard
            name="刘刘-Violthor"
            link="https://ifdian.net/a/glowstonelauncher"
            avatar={<Avatar src={devLiuliu} alt="刘刘-Violthor" />}
          />
          <SponsorCard
            name="Utie Shinvar"
            link="https://ifdian.net/u/fa22f54c8dd411f1b79052540025c377"
            avatar={<Avatar src={skin3d} alt="Utie Shinvar" />}
          />
        </div>
      </section>

      {/* 主动力（感谢） */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">主动力（感谢）</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <CreditCard
            avatar={<Avatar src={mcwiki} alt="MC百科" />}
            name="MC百科"
            contrib="为 GL 提供了 Mod 名称的中文翻译。"
          />
          <CreditCard
            avatar={<Avatar src={easytier} alt="EasyTier" />}
            name="EasyTier"
            contrib="为 GL 赞助版提供了异地联机 / 组网功能。"
          />
          <CreditCard
            avatar={<Avatar src={devUtie} alt="z0z0r4" />}
            name="z0z0r4"
            contrib="为 GL 提供了 Modrinth 与 CurseForge 的社区资源镜像源和帮助图库。"
          />
          <CreditCard
            avatar={<Avatar src={z0z0r4} alt="skin3d" />}
            name="skin3d"
            contrib="为 GL 提供了 3D 人物渲染及动作。"
          />
        </div>
      </section>
    </div>
  );
}
