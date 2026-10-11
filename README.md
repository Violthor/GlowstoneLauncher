<div align="center">
<img width="512" height="512" alt="logo" src="https://github.com/user-attachments/assets/764632c3-d55d-48b5-83bc-7fab9a227c73" />

<br>
Glowstone Launcher

</div>
一款面向 Minecraft Java 版的 Windows 第三方启动器，基于 Electron + React + Vite + TypeScript 构建。
提供版本下载与启动、Java 自动检测/安装、正版（微软）/离线/外置账号、皮肤披风管理、
Modrinth + CurseForge 双源资源下载、本地开服与联机等能力。

> 本项目与 Mojang Studios、Microsoft 没有任何隶属、授权或背书关系。Minecraft 是 Mojang Synergies AB 的商标。

## 版本区别

| 能力 | 普通版 `community` | 赞助版 `sponsor`（默认） |
|---|:---:|:---:|
| 版本下载 / 启动 / Java 管理 / 账号 / 皮肤披风 / 资源下载 / Mod 管理 | ✅ | ✅ |
| 密钥联网激活（硬件绑定） | – | ✅ |
| 本地开服、陶瓦（局域网）联机 | – | ✅ |
| 异地联机（内置 EasyTier 组网内核） | – | ✅ |

普通版在打包时会通过 Rollup 摇除联机/开服相关前端代码，并且不包含 `electron/lan.cjs`、`electron/server.cjs`
与 EasyTier 二进制，安装包更小。

## 技术栈

- Electron 22（主进程为 CommonJS：`electron/*.cjs`）
- React 19 + TypeScript + Vite（前端 `src/`）
- Tailwind CSS 4 + Radix UI + Framer Motion
- skinview3d / three.js（玩家 3D 预览）
- electron-builder（NSIS 安装包）

## 目录结构

```
.
├─ electron/            主进程 / 预加载 / 联机 / 开服 / 激活等 Node 侧逻辑（CommonJS）
│  ├─ main.cjs          主进程入口
│  ├─ preload.cjs       上下文隔离桥（contextBridge）
│  ├─ lan.cjs           陶瓦/异地联机（仅赞助版打包）
│  ├─ server.cjs        本地开服（仅赞助版打包）
│  ├─ license.config.cjs 联网激活服务器地址（需要你自行配置，见下）
│  ├─ shape-window.ps1  Windows 圆角窗口脚本（必须为 UTF-8 BOM + CRLF）
│  └─ splash.html       启动闪屏
├─ src/                 React 前端（页面、组件、状态、数据）
├─ public/              静态资源
├─ build/               应用图标与 NSIS 自定义脚本
├─ scripts/             构建辅助脚本
├─ resources/           打包到 asar 外的额外资源（赞助版的 EasyTier 内核放在 resources/easytier）
├─ electron-builder.cjs 打包动态配置（按 EDITION 区分两版）
└─ vite.config.ts       前端构建配置（按 VITE_EDITION 摇除联机代码）
```

## 环境要求

- Windows 10 / 11（x64）。圆角窗口、开服、联机等能力依赖 Windows 接口。
- Node.js **20 LTS 或更高**（Vite 8 要求）。
- 首次 `npm install` 会下载 Electron 22；国内网络如遇超时，可设置镜像后重试：
  ```bat
  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  npm install
  ```

## 本地运行

主窗口固定加载 `dist/index.html`（未接入开发服务器），因此需要先构建前端再启动 Electron：

```bat
:: 普通版前端
set VITE_EDITION=community
npx vite build
npx electron .
```
```bat
:: 赞助版前端（默认）
set VITE_EDITION=sponsor
npx vite build
npx electron .
```

> 非打包直接 `npx electron .` 时，版本号读取 `electron/edition.generated.cjs`；该文件由打包流程自动生成，
> 缺失时默认按赞助版运行。如需以普通版本地运行，可手动创建该文件：
> `module.exports = { edition: 'community' };`

## 打包安装包

`electron-builder.cjs` 的 `beforeBuild` 会按环境变量 `EDITION` 自动设置 `VITE_EDITION` 重建前端，
并写入 `electron/edition.generated.cjs`，无需手动先跑 vite。

CMD：
```bat
:: 普通版  -> release\GlowstoneLauncher.exe
set EDITION=community&& npx electron-builder --win nsis --x64 --config electron-builder.cjs

:: 赞助版  -> release\GlowstoneLauncher陶瓦联机版赞助版.exe
set EDITION=sponsor&& npx electron-builder --win nsis --x64 --config electron-builder.cjs
```

PowerShell：
```powershell
$env:EDITION='community'; npx electron-builder --win nsis --x64 --config electron-builder.cjs
$env:EDITION='sponsor';   npx electron-builder --win nsis --x64 --config electron-builder.cjs
```

## 自行配置（部署你自己的服务）

下列内容与私有基础设施有关，**公开仓库中的默认值均为空白占位或公共镜像**，请按需自行填写：

1. **联网授权服务器（赞助版）**：编辑 `electron/license.config.cjs` 的 `apiBase`，
   指向你自己部署的密钥校验接口。留空时激活功能不可用、不影响其它功能。
2. **自动更新清单**：编辑 `electron/main.cjs` 中的 `UPDATE_MANIFEST_URLS`，
   可在数组最前面加入你自己的清单地址；默认仅保留公共 CDN 镜像。
3. **私有下载站防盗链**：`electron/main.cjs` 中的 `PRIVATE_DOWNLOAD_HOST` / `PRIVATE_DOWNLOAD_KEY`
   默认为空；仅当你自建带密钥头校验的下载站时才填写，**切勿把真实密钥提交进仓库**。
4. **EasyTier 联机内核（赞助版）**：见 `resources/README.md`，需自行从官方 Release 下载三个文件放到
   `resources/easytier/`。普通版不需要。
5. **微软正版登录客户端 ID**：`electron/main.cjs` 内置的是一个“公共客户端（public client）”ID，
   公共客户端本身不携带 secret、随客户端分发是微软设备码流程的常规做法；如需使用你自己的 Azure 应用，
   在微软 Entra 后台注册公共客户端并替换该 ID 即可。

## 第三方开源组件

见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。联机内核 EasyTier 依据 Apache License 2.0，
本软件仅以子进程方式外部调用其官方程序，不包含、也不修改其源代码。

## 授权协议

本仓库为**源码可见（source-available）**，整体依据随附的 [`LICENSE`](./LICENSE)
（Glowstone Launcher 最终用户许可协议）授权，著作权归 Glowstone Launcher 开发团队所有，
**并非** OSI 意义上的开源软件。未经著作权人书面许可，不得商用、再分发或据其提供同类服务；
个人学习、自用与问题反馈欢迎之。
