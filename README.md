<div align="center">

<img width="512" height="512" alt="logo" src="https://github.com/user-attachments/assets/d66efb0f-a112-4271-a078-3a3b4d9571be" />

<dr>

Glowstone Launcher

</div>

一款面向 Minecraft Java 版的 Windows 第三方启动器

基于 Electron + React + Vite + TypeScript 构建。
提供版本下载与启动、Java自动检测/安装、正版(微软)/离线/外置账号、皮肤披风管理、Modrinth + CurseForge双资源下载、本地开服与联机等能力。

</div>

> 本项目与 Mojang Studios、Microsoft 没有任何隶属、授权或背书关系。Minecraft 是 Mojang Synergies AB 的商标。

## 版本区别
| 能力 | 普通版 community | 赞助版 sponsor（默认） |
| ---- | ---- | ---- |
| 版本下载/启动 / Java管理 / 账号 / 皮肤披风 / 资源下载 / Mod管理 | ✅ | ✅ |
| 密钥联网激活（硬件绑定） | — | ✅ |
| 本地开服、局域网联机 | — | ✅ |
| 异地联机（内置 EasyTier 组网内核） | — | ✅ |

普通版打包时会通过 Rollup 移除联机、开服相关前端代码，不包含 electron/lan.cjs、electron/server.cjs 以及 EasyTier 二进制文件，安装包体积更小。

## 技术栈
- Electron 22（主进程为 CommonJS：`electron/*.cjs`）
- React 19 + TypeScript + Vite（前端 `src/`）
- Tailwind CSS 4 + Radix UI + Framer Motion
- skin3d / three.js（玩家3D皮肤预览）
- electron-builder（NSIS安装包）

## 第三方开源组件声明
启动器部分功能使用以下开源库，各组件版权归原作者所有：
- skin3d：3D皮肤渲染动画
- EasyTier：异地组网联机功能

本启动器基于开源框架 Electron + electron-vite 开发，框架版权归原作者所有；启动器业务逻辑、UI界面、MC相关功能代码由本人独立开发。

## 重要声明
1. GlowstoneLauncher 为第三方自制 Minecraft 启动器，**非 Mojang、微软官方出品**，与 Mojang、Microsoft 无任何隶属关系。
2. Minecraft 商标、游戏本体版权归 Mojang Studios 及微软所有；本项目仅提供游戏启动管理工具，**不提供游戏本体文件**。
3. 本启动器分为普通版与赞助版，赞助仅为对开发者的支持，不代表购买游戏版权。
4. 项目内使用的第三方开源组件，版权归对应原作者所有，请遵守各组件开源协议。
5. 禁止将本启动器用于商业倒卖、恶意捆绑、破解分发等违规用途。

## 下载
> ⚠️ Edge浏览器提示【无法安全下载】无保留按钮解决办法
> 方式A（推荐）：切换备用渠道，前往 GitHub Release 下载安装包，GitHub域名安全信誉更高。
> 方式B：下载ZIP压缩包版本，压缩包不容易被浏览器安全拦截，下载完成后解压得到安装程序。
> 方式C：临时关闭Edge的Microsoft Defender SmartScreen，下载完成记得重新开启保护。

文件SHA256：`在此填入你的安装包哈希值`

## 目前发展
正式版 v1.0.0 已发布
正式版 v1.0.1即将发布
