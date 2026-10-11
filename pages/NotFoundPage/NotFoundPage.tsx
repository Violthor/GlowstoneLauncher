import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Home } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
      <p className="text-lg mt-4 text-muted-foreground">页面未找到</p>
      <Link to="/" className="mt-6">
        <Button className="gap-2"><Home className="size-4" />返回首页</Button>
      </Link>
    </div>
  );
}
