# resources/easytier（赞助版联机内核，需自行下载）

赞助版（sponsor）的“异地联机”依赖 [EasyTier](https://github.com/EasyTier/EasyTier)（Apache License 2.0）。
本仓库**不包含**这些第三方二进制（体积较大且有独立发布节奏），打包赞助版前请自行从官方 Release 下载，
并在本目录（`resources/easytier/`）放置以下三个文件：

| 文件 | 说明 |
|---|---|
| `easytier-core.exe` | 组网核心（守护进程） |
| `easytier-cli.exe` | 命令行查看工具（节点 / 邻居状态） |
| `wintun.dll` | 用户态虚拟网卡依赖（随官方 Windows 包提供） |

开发与验证时使用的版本为 **EasyTier v2.6.4**（Windows x64）。建议下载同一大版本以保证参数兼容。
放置后目录结构应为：

```
resources/
└─ easytier/
   ├─ easytier-core.exe
   ├─ easytier-cli.exe
   └─ wintun.dll
```

`electron-builder.cjs` 仅在赞助版打包时把该目录复制到安装包 `resources/easytier/`；普通版不会包含它。
EasyTier 著作权归其权利人所有，本项目仅以子进程方式外部调用官方程序，不包含、也不修改其源代码。
