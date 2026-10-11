# 第三方开源组件声明 / Third-Party Notices

Glowstone Launcher（萤石启动器）为自主研发的软件，整体依据随附的《LICENSE》（Glowstone
Launcher 最终用户许可协议）授权，**不采用任何第三方启动器的开源协议**。

本软件在开发过程中使用了下列通用、免费的第三方开源**基础库 / 运行时**。它们是业界广泛
使用的底层工具（并非“某款启动器”的代码或协议），其著作权归各自权利人所有，并依据其
原始许可协议授权。完整依赖清单见 `package.json`。

## 主要第三方组件

| 组件 | 用途 | 许可协议 |
|---|---|---|
| Electron | 跨平台桌面运行时（Chromium + Node.js） | MIT |
| React / React DOM | 界面渲染框架 | MIT |
| three.js | WebGL 3D 渲染底层库 | MIT |
| skin3d（skinview3d） | Minecraft 玩家 3D 模型渲染与人物动画（待机/行走/奔跑/潜行/游泳）、皮肤与披风展示、鼠标拖拽旋转 | MIT |
| Framer Motion | 界面动画库 | MIT |
| Radix UI | 无障碍界面基础组件 | MIT |
| Tailwind CSS | 样式框架 | MIT |
| Lucide React | 图标库 | ISC |
| React Router | 前端路由 | MIT |
| electron-builder | Windows 安装包构建工具 | MIT |
| zod | 数据校验库 | MIT |
| date-fns | 日期处理库 | MIT |
| clsx / tailwind-merge | 样式类名工具 | MIT |
| sonner | 轻量提示组件 | MIT |
| EasyTier（外部程序） | 赞助版异地联机/组网能力，本软件仅以独立进程外部调用其官方 `easytier-core.exe`，不复制其源码 | Apache-2.0 |

### skin3d（skinview3d）

- 项目名：skin3d（npm 包名 skinview3d）
- 开发团队：cosmic-fi
- 仓库地址：https://github.com/cosmic-fi/skin3d
- 许可协议：MIT
- 说明：**本软件的 Minecraft 玩家 3D 模型渲染、人物动画（待机、行走、奔跑、潜行、游泳）、
  皮肤与披风展示以及鼠标拖拽旋转模型能力，均由 skin3d 项目提供**；skin3d 基于 three.js
  构建。本软件未自行编写底层 WebGL 渲染。

### EasyTier（异地联机，外部调用）

- 项目地址：https://github.com/EasyTier/EasyTier
- 许可协议：Apache-2.0
- 说明：赞助版的异地组网能力由 EasyTier 项目提供。本启动器**仅以独立进程外部调用官方
  发布的 `easytier-core.exe` 程序，不直接嵌入 EasyTier 源码**；退出异地联机时自动关闭
  该进程。异地组网所产生的网络连接与数据传输由 EasyTier 及用户自行负责。

其余依赖（@radix-ui/* 系列、cmdk、vaul、react-hook-form、react-markdown、remark-gfm、
embla-carousel-react、next-themes、class-variance-authority、input-otp、react-day-picker、
react-resizable-panels、react-error-boundary、@hookform/resolvers、tw-animate-css 等）
均为 MIT / ISC 类宽松许可的通用基础库。

## 说明

1. 上述组件的许可文本随其官方源代码分发；可在对应项目官网或 `node_modules/<组件>/LICENSE`
   查阅原文。
2. 使用这些 MIT/ISC 基础库，不改变 Glowstone Launcher 自有代码（启动器架构、下载安装、
   账号与授权、界面与交互、美术与文案等）的著作权归属，也不导致本软件整体适用任何
   第三方启动器的开源协议。
3. Minecraft 是 Mojang Studios / Microsoft 的商标，本软件不包含、也不分发 Minecraft
   游戏本体。

(c) Glowstone Launcher 开发团队
