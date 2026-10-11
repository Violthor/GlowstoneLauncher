// Build edition. 'community' = 普通版（无陶瓦联机）；其它/缺省 = sponsor（赞助版，含陶瓦联机）。
// VITE_EDITION 在打包前由构建流程注入（见 electron-builder.cjs / 构建命令）。
export const EDITION: 'community' | 'sponsor' =
  import.meta.env.VITE_EDITION === 'community' ? 'community' : 'sponsor';

export const HAS_LAN = EDITION !== 'community';
