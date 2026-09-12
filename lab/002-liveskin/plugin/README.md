# LiveSkin

DSH Web 的**皮肤系统插件**。与 `@linxin666/dsh-client-ui-skin-center` 完全独立：自己的状态目录、自己的 API 前缀、自己的 DOM 契约，两边互不读写。

它想解决的问题是**分级**：一套皮肤不该是一整块 CSS，而应该是一棵树——大类定义能力与调色板，小类只表达差异，档位再把参数打包。

```
FrutigerAeroFamily              大类 family   共享参数 schema、共享 CSS、家族级预设
├── FrutigerAero                小类 variant  自有 CSS 叠在大类之上；只覆盖要改的默认值
├── DarkAero                    小类 variant
└── AeroGlass                   小类 variant
        └── 清淡 / 标准 / 浓郁    档位 preset  一组参数取值的命名打包
```

## 一级：插件给皮肤的能力

| 能力 | 说明 |
| --- | --- |
| 参数 schema | `number`（滑块）/ `boolean`（开关）/ `color`（取色器）/ `enum`（下拉）/ `text` |
| 参数 → CSS 变量 | 每个参数自动得到一个变量，默认 `--ls-<kebab-case(key)>`，可用 `cssVar` 改名 |
| enum 携带 CSS 载荷 | 选项可带 `css` / `cssDark`，一个下拉就能换整张壁纸（值是一整串 `background-image` 图层） |
| 小类覆盖默认值 | 小类写 `defaults: { wallpaper: "deep" }` 即可，不必把整段 schema 抄一遍 |
| 家族级预设 | 大类定义的预设自动传给所有小类，小类可按 id 覆盖同名预设 |
| 层叠顺序 | 大类文件 → 大类 inline → 小类文件 → 小类 inline，后者天然压前者，无需工具链 |
| 双根覆盖 | 内置根 `<package>/skins`，用户根 `$DSH_HOME/live-skin/skins`；同 familyId 时用户根整体覆盖 |
| 试穿 / 应用分离 | 拖动与换小类只写变量（即时预览），点「应用」才落盘 |
| 单参数恢复默认 | 改过的参数旁出现 `↺`，一键回到该参数的默认值 |
| 导入 / 导出 | 当前取值导出成一段 JSON，粘回来即可还原；只认本小类声明过的参数 |
| 变量表 | 面板里直接列出运行时写到 `<html>` 上的每个 `--ls-*` 及其取值 |

## 二级：皮肤作者看到的世界

一个皮肤家族就是一个目录树：

```
<root>/FrutigerAeroFamily/
  family.json                     大类：name / params / presets / styles
  base.css                        大类样式
  FrutigerAero/
    skin.json                     小类：name / defaults / params / presets / styles
    skin.css                      小类样式（叠在大类之上）
    assets/**                     小类私有静态资源
  DarkAero/
    skin.json
    skin.css
```

### `family.json` / `skin.json`

```jsonc
{
  "manifestVersion": 1,
  "name": "显示名",
  "description": "一句话",
  "accent": "#0f7fc4",        // 列表里的色点
  "category": "朋克美学",      // 必填：面板里按它分成几行，取值见宿主常量 CATEGORIES
  "hidden": false,            // true = 不出现在目录册里
  "styles": ["base.css"],     // 相对本目录的样式文件，按顺序叠加
  "css": "/* 也可以直接内联 */",
  "params": [ /* 见下表 */ ],
  "presets": [
    { "id": "calm", "name": "清淡", "values": { "glass": 74, "blur": 8 } }
  ]
}
```

小类额外支持 `defaults`（只改继承参数的默认值）：

```jsonc
{
  "name": "DarkAero",
  "defaults": { "accent": "#35c6f0", "wallpaper": "deep", "glass": 66 },
  "presets": [
    { "id": "standard", "name": "标准（夜光）", "values": { "glass": 66, "blur": 14 } }
  ],
  "styles": ["skin.css"]
}
```

### 参数声明

```jsonc
{
  "key": "bubbleAmount",      // 必填，^[a-zA-Z][a-zA-Z0-9_-]{0,63}$
  "type": "number",           // number | boolean | color | enum | text
  "label": "气泡浓度",         // 控件标签
  "description": "同时控制疏密与明显程度",
  "group": "气泡",             // 界面分组标题
  "unit": "%",                // number 专用，拼进变量值
  "min": 0, "max": 100, "step": 2,
  "default": 55,
  "cssVar": "--ls-bubble-amount"   // 可选，默认 --ls-<kebab(key)>

  // enum 专用；选项可携带 CSS 载荷
  // "options": [
  //   { "value": "sky", "label": "晴空草地",
  //     "css": "radial-gradient(...), linear-gradient(...)",
  //     "cssDark": "linear-gradient(...)" }
  // ]
}
```

取值一定落在合法域内：数字夹到 `[min, max]`；域外的值（非法颜色、不存在的枚举项、非数字、布尔以外的东西）回落到**该参数声明的默认值**；未声明的 key 直接丢弃。

宿主与客户端各有一份收束实现（预览不能等一次往返），测试台 7b 段逐例对照两者，防止「预览看着对、一应用就变样」。

### 皮肤 CSS 里的变量

运行时写在 `document.documentElement` 上，并给 `<html>` 加上 `data-live-skin="<family>/<variant>"`：

```
--ls-<key>            每个参数一个
--ls-<key>-dark       enum 选项带 cssDark 时的暗色载荷
```

皮肤 CSS 请一律限定在 `html[data-live-skin]` 之下，这样停用后不可能残留影响。典型写法：

```css
html[data-live-skin] {
  --ls-glass-alpha: calc(.88 - var(--ls-glass, 55) * .0062);
  --dsw-alias-bg-base: rgba(247, 253, 255, var(--ls-glass-alpha));
  --dsw-alias-brand-primary: var(--ls-accent, #0f7fc4);
}

html[data-live-skin] body {
  background-image: var(--ls-wallpaper, none);
  background-attachment: fixed;
}

html[data-live-skin] body[data-ds-dark-theme] {
  background-image: var(--ls-wallpaper-dark, var(--ls-wallpaper, none));
}
```

## HTTP 面

全部挂在 `/api/live-skin/v1`，同源围栏只作用于写操作。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 存活 + 内外两个皮肤根 |
| GET | `/catalog` | 家族 / 小类 / 合并后的参数 schema / 预设 / 诊断 |
| GET | `/skin/<family>/<variant>/css` | 层叠并拼好的整份 CSS |
| GET | `/skin/<family>/<variant>/asset/<path>` | 小类私有资源（越界一律 404） |
| GET | `/state` | 已提交的选择、原始值、以及按当前 schema 解算后的值 |
| POST | `/state` | `{ active?, skin?, values?, preset?, prefs? }` 局部合并写入 |

状态文档：`$DSH_HOME/live-skin/state.json`（同目录 tmp → rename 原子写）。

## 与 skin-center 的关系

**没关系。** 两边各自的：

| | LiveSkin | skin-center |
| --- | --- | --- |
| DOM 契约 | `html[data-live-skin]` | `html[data-dsh-skin]` |
| 变量前缀 | `--ls-*` | `--dsw-skin-*` |
| 状态 | `$DSH_HOME/live-skin/state.json` | `$DSH_HOME/skin-center-active.json` |
| API | `/api/live-skin/v1` | `/api/skin-center/v2` |
| 分级 | family / variant / preset | 平铺列表 |

两者同时启用会互相叠加，面板里会给出提示。切回「设置 → 皮肤中心 → 官方默认」再启用 LiveSkin 即可。

## 安装

```sh
dsh plugin --profile web add link:/absolute/path/to/lab/002-liveskin/plugin
```

若该命令被 profile 的 pnpm 策略拒绝（`minimumReleaseAge` 等），等价的手工接线是：

1. `profile/package.json` 的 `dependencies` 加 `"dsh-live-skin": "link:<绝对路径>"`
2. 同文件 `dsh.profile.bundles` 追加 `"dsh-live-skin"`
3. `ln -s <绝对路径> profile/node_modules/dsh-live-skin`

改完需要重启 DSH；插件行来自本包的 `cordis.patch.yml`，客户端半边由 `dsh-client-modules` 依 `dsh.client` + `exports["./client"]` 自动发现。

## 开发

```sh
node ../test/run.mjs
```

60 项断言，分十二段（另含 `[5b] CSS 审计` 的 C2、C4–C11）：

| 段 | 查什么 |
| --- | --- |
| 1 宿主半边 | 包清单与插件名一致、`apply()` 注册了那条 prefix 路由 |
| 2 分级模型 | 家族→小类、参数继承、`defaults` 覆盖、预设按 id 合并、enum 的 css/cssDark 载荷 |
| 3 样式层叠 | 大类层排在小类层之前、全部限定在 `html[data-live-skin]`、路径穿越被拒 |
| 4 状态持久化 | 落盘、越界夹取、未知 key 丢弃、未装皮肤 404、跨源 403、预设写入 |
| 5 皮肤 linter | 变量是否都有出处、有没有死旋钮、预设 key 是否指向已声明参数、enum 载荷是否成对；以及**声明 `--dsw-*` 的规则必须落在 `body` 上** |
| 5b CSS 审计 | 对**每一个 variant** 逐一执行：选择器作用域（C2）、关键帧只动合成属性（C5）、`backdrop-filter` 只在小浮层（C6）、稳定锚点（C7）、零外部资产（C8）、不注入文本（C9）、不重复声明参数的 cssVar（C10）、number 参数的兜底值同型（C11）、两档约定（C12）、前景/底色消费对的对比度（C4：按真实层叠解算，含官方回落、特异性、各分支、半透明与渐变，并有 `@body` 页面级探针） |
| 6 客户端半边 | bundle id 与包名一致、只依赖 slots、注册 `settings.section`、注入面板样式 |
| 7 运行时 DOM 契约 | 假 DOM 上驱动 runtime：装样式表 / 盖属性 / 写变量、enum 载荷与 `-dark` 派生、preview 只动变量、restore 回滚、clear 拔干净、dispose 摘标签 |
| 7b 两半边一致性 | 宿主的 `coerceValue` 与客户端的 `coerceParamValue` 逐例对齐 —— 不一致会让预览和落盘分歧 |
| 7c 面板样式纪律 | hover 改背景的规则必须同时钉住文字色；填充态按钮必须有自己的 hover 填充色 |
| 8 启动即恢复 | `apply()` 是否把已保存的皮肤直接画到 DOM 上（跨刷新存活），以及没保存时绝不擅自换脸 |
| 9 面板状态同步 | 关掉再打开设置面板时显示的是**最新应用过**的皮肤，而不是插件启动那一刻的快照 |
| 10 组合接线自检 | 按 loader 的方式叠加全部 bundle patch，确认本插件的行在配置树里，且两个入口都能解析 |
| 11 线上代码新鲜度 | 从 HMR 的 SSE 通道取启动图，按图里的 URL 拉下浏览器真正会加载的那份 bundle，与磁盘逐字节比对 |

### 家族分类

面板里家族按**分类**分成几行，一行一类。分类写在 `family.json` 的 `category` 里，
行序由宿主常量 `CATEGORIES`（`lib/index.js`）给出 —— 面板只负责显示，不自己排序。

| 分类 | 家族 |
| --- | --- |
| `朋克美学` | 七个朋克家族（时间轴） |
| `千禧年美学` | `FrutigerAeroFamily`（紧挨时间轴右端：企业版的乐观） |
| `星际争霸` | 人族 / 虫族 / 神族（不在时间轴上） |

分类漏写或写成没声明过的值会在目录册里报诊断 —— 否则它会悄悄混进别的行，
而面板上没有任何东西提示这件事。

### 面板里怎么标「正在使用」和「支持哪些档位」

- **状态栏**用**友好名字**显示当前生效的那一套（`家族名 · 皮肤名`），后面跟一个档位徽章；
  当你在浏览别的皮肤时，旁边会出现「回到当前」按钮，一键切回正在生效的那一套。
- **家族 chip** 与**皮肤卡片**分别带「使用中」标记（卡片是左侧强调条 + 胶囊）。
  注意它与 `[data-on]`（正在查看）是**两件事** —— 浏览别的皮肤时，标记仍然指向生效的那一套。
- **档位徽章**说明这一支在两档分别是什么样：
  「亮 / 暗 跟随系统」= 亮色模式一套、暗色模式一套；「仅暗色观感」/「仅亮色观感」= 两档同一套观感。

档位**不是手写声明**，而是宿主读皮肤自己的 CSS 推导出来的（`lib/appearance.js`）：
找在该模式下真正生效的 `body` 底色（考虑 `:not(...)` 守卫、`[data-ds-dark-theme]` 守卫、
逗号列表的每一个分支、以及选择器特异性），再算相对亮度。手写声明会跟皮肤实际做的事漂移，
而用户正是拿这句话判断「切到暗色会不会变样」。

### 改动什么时候生效

| 改了什么 | 生效方式 |
| --- | --- |
| `skins/**` 的 CSS / JSON | 每次请求现读，**刷新页面**即可 |
| `lib/client.js`（客户端半边） | HMR 轮询到新版本即收录，**刷新页面**即可 |
| `lib/index.js`、`lib/appearance.js`（宿主半边） | 进程启动时加载，**必须重启 DSH** |

宿主半边是不是旧的，验收台 `[11]` 会直接报出来：宿主在 `/health` 里上报它**加载那一刻**
读到的自身 mtime，与磁盘现值不一致就判失败。客户端对旧宿主会优雅降级（不显示档位徽章），
但目录册里的 `appearance` 字段要等重启才有。

### 写皮肤时的两档约定（踩过的坑，务必照做）

皮肤样式表是运行时**后插**进 head 的，所以「谁生效」由特异性决定，不是文档顺序：

| 规则 | 选择器 | 特异性 |
| --- | --- | --- |
| 皮肤浅色块 | `html[data-live-skin] body` | (0,1,2) |
| 官方暗色块 | `body[data-ds-dark-theme]` | (0,1,1) |
| 皮肤暗色块 | `html[data-live-skin] body[data-ds-dark-theme]` | (0,2,2) |

1. **亮色默认的家族**：默认块写 `html[data-live-skin] body:not([data-ds-dark-theme])`，
   暗色覆盖写 `body[data-ds-dark-theme]`。否则浅色值会在暗色档压过官方暗色值，
   输入框/代码块/列表选项还是亮的，配浅色文字整片看不见。
2. **暗色默认的家族**：默认块保持 `body`，亮色微调放 `body:not([data-ds-dark-theme])`。
3. **强制单一观感的变体**（永远白 / 永远暗）：两个档的选择器**成对**列出
   `body:not([data-ds-dark-theme]), body[data-ds-dark-theme]`。只写 `body` 会在亮色档输给大类的浅色块。
4. **两档都要重画 `body` 底色**：`background-color` 不在 token 体系里，上面几条覆盖不到它。
5. 参数派生的 `--ls-*` 中间量留在**两档共用**的规则里，只把 `--dsw-*` 调色板分档。
6. **亮色默认的家族，暗色块要写全**：不只是 bg-base / layers / labels，还包括零件级 token
   （遮罩、滚动条、状态色、markdown 芯片、按钮变体、交互底色、阴影）。只写主体面的话，
   其余会沿用浅色值或落回官方中性色。补齐可用 `python3 scripts/gen-dark-parity.py --check`
   看还缺哪些，`--emit <Family>` 打印建议值（规则与踩坑见 `../docs/10_工程约束与验收.md`）。
7. **链接不能直接用强调色**：它是为填充与描边挑的。亮底压深、暗底提亮，
   `color-mix(in srgb, var(--ls-accent, …) 42%, #0b1116)` / `… 44%, #ffffff`。
   极性跟着**页面**走：暗色默认的家族两档都要提亮；强制单一观感的变体写自己的链接。

测试台用假 ctx 把宿主半边挂起来开真 HTTP 服务，再物化客户端 bundle —— **不需要重启 DSH 就能验证改动**。

linter 是给皮肤作者用的，目前盯着四类错误：

- 写了 `var(--ls-typo)` 却忘了声明对应参数；
- 声明了参数却从没用过（死旋钮）；
- 预设里的 key 指向一个不存在的参数；
- **把 `--dsw-*` 声明在 `html` 上而不是 `body` 上**。

最后一条值得单独说：官方调色板声明在 `body`（`body{--dsw-alias-…}`）。皮肤的 token 若落在 `html` 上——哪怕选择器是特异性更高的 `html[data-live-skin]`——使用 token 的元素仍会从**更近的祖先 `body`** 继承到官方值，皮肤静默失效：只有不走 token 的规则（例如直接写在 `body::after` 上的气泡）还看得见，表现为「有气泡但没壁纸」。
