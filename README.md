# DSH 实验室 001 号（dsh001）

> 本工作区是 **DSH 实验室的第 001 号**：一个用来动手做实验的沙盒，而不是某一个产品的代码仓库。
> 每个实验独立成篇、独立可跑、独立记录结论；实验产物放在 `lab/<编号>-<名称>/`，
> 实验之间的公共设施（文档、提交规范、Git 钩子）放在仓库根。

## 实验清单

| 编号 | 实验 | 目录 | 状态 | 一句话 |
| --- | --- | --- | --- | --- |
| 001 | 知识卡片 | `lab/001-knowledge-cards/` | 可用 | 零依赖的知识卡片管理程序，原生单文件版 + React 版共享同一份本地数据（分类树、标签树、SM-2 间隔重复复习） |
| 002 | LiveSkin 皮肤系统 | `lab/002-liveskin/` | 1.1 | DSH Web 的皮肤插件，用 family（大类）/ variant（小类）/ preset（档位）三级模型替代「一整块 CSS」 |

新增实验的约定：

1. 在 `lab/` 下新建 `<三位编号>-<短横线英文名>/`，编号自增、不复用；
2. 实验自带的说明写在实验目录的 `README.md` 里，根 `README.md` 只登记一行摘要；
3. 实验之间不互相 `import`；需要共享的东西上提到仓库根，并在这里说明；
4. 单个实验如需独立打包/构建，把自己的 `package.json` 放在实验目录内，根目录不引入构建链；
5. 每个实验有自己的 `CHANGELOG.md`，根 `CHANGELOG.md` **只记仓库级改动**
   （详见 [`CONTRIBUTING.md`](CONTRIBUTING.md) 第六章）。

## 目录结构

```text
dsh001/
├── README.md                     # 本文件：实验室总览与实验登记
├── CONTRIBUTING.md               # Git 提交规范（含自动提交与中文提交约定）
├── .gitignore / .gitmessage      # 忽略配置、提交信息模板
├── .githooks/                    # 版本化的 Git 钩子（commit-msg / pre-commit）
├── lab/
│   ├── 001-knowledge-cards/      # 实验 001：知识卡片
│   │   ├── README.md             #   实验自己的说明（功能、快捷键、运行方式、数据结构）
│   │   ├── index.html            #   原生版：单文件，双击即用
│   │   ├── react-app/            #   React 版：Vite + React 18 + vitest
│   │   └── viz/                  #   排序算法可视化（卡片排序特性的配套页面）
│   └── 002-liveskin/             # 实验 002：LiveSkin 皮肤系统
│       ├── README.md             #   实验说明与文件索引
│       ├── plugin/               #   插件包根：package.json / lib / skins
│       ├── docs/                 #   设计文档集（家族总表、分支规格、工程约束）
│       ├── test/                 #   冒烟测试台 run.mjs
│       └── archive/              #   前身：skin-center 时代的 Aero 皮肤构建脚手架
└── doc/
    └── punks/                    #   朋克专题五卷（LiveSkin 的内容底座）
```

> ⚠️ `lab/002-liveskin/plugin/` 被 DSH Web profile 以 `link:<绝对路径>` 引用，
> 另有一个 `node_modules/dsh-live-skin` 符号链接指向它（见 `~/.dsh/profiles/web/`）。
> **移动或改名这个目录会让已安装的皮肤插件失效** —— 必须同步改这两处并重启 DSH。
> 仓库根目前留着一个迁移期的兼容符号链接 `dsh-live-skin → lab/002-liveskin/plugin`，
> 让**重启前**已在运行的宿主仍能按旧路径读到插件；重启后可删除（已加进 `.gitignore`）。

## 运行实验 001

原生版：直接用浏览器打开 `lab/001-knowledge-cards/index.html`。

React 版：

```bash
cd lab/001-knowledge-cards/react-app
npm install                 # 依赖（npm 缓存目录权限有问题时加 --cache ./node_modules/.npm-cache）
npm run dev                 # 开发服务器
npm test                    # vitest 单测
npm run build && npm run preview
```

功能、快捷键、localStorage 数据结构等细节见 [`lab/001-knowledge-cards/README.md`](lab/001-knowledge-cards/README.md)。

## Git 管理

本工作区纳入 Git 管理，远程仓库：<https://github.com/andyluss/dsh001>（默认分支 `main`）。

| 事项 | 约定 |
| --- | --- |
| 提交信息 | Conventional Commits 子集：`<type>(<scope>): <中文描述>`，**描述必须是中文** |
| 自动提交 | 只在「一件可独立描述的改动已完成且自检通过」时提交；一次提交只做一件事；禁止 `git add -A` 一把梭 |
| 强制手段 | `.githooks/commit-msg` 校验格式与中文，`.githooks/pre-commit` 拦截依赖/构建产物与大文件 |
| 忽略配置 | 根 `.gitignore`（依赖、构建产物、系统与编辑器垃圾）；`node_modules/`、`dist/`、`.DS_Store` 永不入库 |
| 钩子启用 | `git config core.hooksPath .githooks`（换机器克隆后执行一次） |

完整规则、类型表与正反例见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。提交规范只约束**信息**，不约束实验内容。
