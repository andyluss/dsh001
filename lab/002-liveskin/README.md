# 实验 002 · LiveSkin 皮肤系统

> DSH Web 的皮肤插件：用 **family（大类）/ variant（小类）/ preset（档位）** 三级模型
> 替代「一整块 CSS」，与既有的 skin-center 完全独立（各自的目录、路由前缀与 DOM 契约）。
>
> 插件的技术细节 —— 目录模型、参数 schema、HTTP 面、安装与退场 —— 见
> [`plugin/README.md`](plugin/README.md)；设计依据与工程约束见 [`docs/`](docs/README.md)。

## 目录

| 路径 | 内容 |
| --- | --- |
| `plugin/` | **插件包根**（`package.json` 所在层）。`lib/` 三个文件分别是宿主半边、客户端半边与档位推导；`skins/` 8 家族 31 套皮肤；`scripts/gen-dark-parity.py` 是暗色 token 的补齐工具 |
| `docs/` | 设计文档集：家族总表、光谱轴、材质签名登记、七份分支规格、工程约束 C1–C13 |
| `test/` | 冒烟测试台 `run.mjs`，63 项断言 |
| `archive/aero-skin-build/` | **前身**：skin-center 时代的 Frutiger Aero 皮肤构建脚手架（见文末） |
| `CHANGELOG.md` | 本实验的变更日志（仓库级改动见[根变更日志](../../CHANGELOG.md)） |

## 跑测试

```sh
node test/run.mjs
```

测试台会把宿主半边挂进一个假 ctx、开一个真的 `node:http` 服务、再把客户端 bundle 物化，
所以**不需要重启 DSH 就能验证改动**。它自己用 `test/.home/` 当 `$DSH_HOME`（运行时生成，不入库）。

第 `[11]` 段会比对线上与磁盘是否同一版：没有运行中的 DSH 时自动跳过；跑着的时候，
它若报「需要重启 DSH」，意思是宿主半边（`lib/index.js`、`lib/appearance.js`）加载的还是旧文件。

## 改动什么时候生效

| 改了什么 | 生效方式 |
| --- | --- |
| `plugin/skins/**` 的 CSS / JSON | 每次请求现读，**刷新页面**即可 |
| `plugin/lib/client.js` | HMR 轮询到新版本即收录，**刷新页面**即可 |
| `plugin/lib/index.js`、`plugin/lib/appearance.js` | 进程启动时加载，**必须重启 DSH** |

## 安装接线（改动目录前必读）

插件是被 **DSH Web profile 用绝对路径 link 进来**的，仓库外有两处接线：

1. `~/.dsh/profiles/web/package.json` → `"dsh-live-skin": "link:/…/lab/002-liveskin/plugin"`
2. `~/.dsh/profiles/web/node_modules/dsh-live-skin` → 指向同一路径的符号链接

**移动或改名 `plugin/` 会让已安装的插件失效**，必须同步改这两处并重启 DSH。

目录从 `dsh-live-skin/` 迁到 `lab/002-liveskin/plugin/` 时，仓库根留了一个**兼容符号链接**
`dsh-live-skin → lab/002-liveskin/plugin`：运行中的宿主在 `import.meta.url` 上算出的
`skins/` 路径是旧的，没有它会在重启前直接读不到皮肤文件。它是一个指向旧位置的链接，
**重启 DSH 后即可删除**（已在 `.gitignore` 里，不会入库）。

## archive 里是什么

`archive/aero-skin-build/` 是 LiveSkin **之前**的做法：给皮肤中心（skin-center）生成
Frutiger Aero 三支配方。它的产物用的是另一套 schema（`schemas.linxin666.org/dsh-skin/v2.json`
+ `patches.css`），和 LiveSkin 的 `family.json` / `skin.json` 不通用。

它留在仓库里是因为 LiveSkin 的 `FrutigerAeroFamily` 正是从这套配色与材质语言演化来的，
可以当作对照；但**它不是 LiveSkin 的一部分**，改 LiveSkin 时不需要动它。
