/**
 * LiveSkin —— 宿主半边。
 *
 * 职责：皮肤仓库（分级 family / variant / preset）、参数 schema 校验与合并、
 * CSS 层叠、HTTP 路由、活动状态持久化。
 *
 * 与 skin-center 完全独立：自己的目录（$DSH_HOME/live-skin）、自己的路由前缀
 * （/api/live-skin/v1）、自己的 DOM 契约（html[data-live-skin] 与 --ls-* 变量），
 * 不读也不写它的任何状态。
 *
 * 皮肤目录模型：
 *
 *   <root>/<familyId>/family.json          大类：共享参数、共享 CSS、预设
 *   <root>/<familyId>/<variantId>/skin.json  小类：自有参数（按 key 覆盖大类）、自有 CSS
 *   <root>/<familyId>/<variantId>/assets/**  小类私有静态资源
 *
 * root 有两处，用户根覆盖内置根的同一 familyId：
 *   内置：<package>/skins
 *   用户：$DSH_HOME/live-skin/skins
 *
 * @module dsh-live-skin
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { analyzeAppearance } from './appearance.js'

export const name = 'dsh-live-skin'
export const inject = ['webServer']

/** 清单 / 状态文档的结构版本，只做结构校验，不做兼容协商。 */
export const MANIFEST_VERSION = 1
/** 整条 HTTP 面的版本前缀。 */
export const API_PREFIX = '/api/live-skin/v1'

/**
 * 家族分类（面板里一行一类）与**行序**。
 *
 * 顺序不写死在面板里：面板只是显示，分类与顺序是数据。
 * 这一行是轴序不是字母序 —— 七个朋克家族组成那条时间轴，千禧年美学紧挨着它的
 * 右端（Aero 是这批可疑未来全部落空之后企业给出的最后一次乐观），
 * 星际争霸三族不在轴上，单独一行。
 */
export const CATEGORIES = [
  { name: '朋克美学', basis: '按光谱轴' },
  { name: '千禧美学', basis: '按血缘与年代' },
  { name: '星际争霸', basis: '按种族' }
]

/** 只有名字的视图，校验与排序用。 */
export const CATEGORY_NAMES = CATEGORIES.map((entry) => entry.name)

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILTIN_SKINS_DIR = join(PACKAGE_ROOT, 'skins')
const STATE_FILE = 'state.json'

/**
 * 插件版本，取自 package.json。
 * 发布之后要能在**运行时**被问出来：`/health` 与设置面板都会带上它 ——
 * 否则「线上跑的是哪一版」只能靠 git tag 猜。
 */
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
})()

/**
 * 宿主半边（本进程加载的那一半）的源文件清单与内容哈希。
 *
 * 宿主是进程启动时加载的，改了不重启不生效；客户端半边由 HMR 现取，另有逐字节比对。
 * 把这几个值报给 /health，验收台就能判断「线上宿主是不是旧的」。
 *
 * 为什么用**内容哈希**而不是文件 mtime：内容相同的重写会改 mtime 却什么都没变 ——
 * `git checkout` / `git reset` / 编辑器保存 / `touch` 都会触发，
 * 于是「明明重启过了却还被判成需要重启」。反过来，只比单个文件的 mtime 又会漏掉
 * 另一半宿主代码（appearance.js）的改动。
 *
 * 新增宿主半边模块时**必须登记进 HOST_SOURCES**：验收台会核对这份清单与 lib/ 下的
 * 实际文件，忘了登记会直接报错，而不是静默漏检。
 */
const HOST_SOURCES = ['appearance.js', 'index.js']
const LOADED_AT = Date.now()
const SOURCES_HASH = (() => {
  try {
    const libDir = dirname(fileURLToPath(import.meta.url))
    const hash = createHash('sha256')
    for (const name of HOST_SOURCES) {
      hash.update(name).update('\0').update(readFileSync(join(libDir, name)))
    }
    return hash.digest('hex').slice(0, 16)
  } catch {
    return null
  }
})()

/** 参数类型表；enum 的取值来自 options。 */
const PARAM_TYPES = new Set(['number', 'boolean', 'color', 'enum', 'text'])

// ---------------------------------------------------------------------------
// 路径
// ---------------------------------------------------------------------------

/** LiveSkin 的 harness home 子目录：$DSH_HOME/live-skin。 */
export function liveSkinHome() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'live-skin')
}

/** 用户皮肤根：$DSH_HOME/live-skin/skins。 */
export function userSkinsDir() {
  return join(liveSkinHome(), 'skins')
}

/** 随包发布的内置皮肤根。 */
export function builtinSkinsDir() {
  return BUILTIN_SKINS_DIR
}

/** 活动状态文档的绝对路径。 */
export function statePath() {
  return join(liveSkinHome(), STATE_FILE)
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function str(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function strArray(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string' && item.length > 0)
}

/** camelCase / 任意串 → kebab-case，用于参数默认 CSS 变量名。 */
function kebab(text) {
  return String(text)
    .replace(/[A-Z]/g, (ch) => '-' + ch.toLowerCase())
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** 目录下的一级子目录名（跳过隐藏项与保留名）。 */
function listDirs(dir, skip) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.') || skip.has(entry.name)) continue
    out.push(entry.name)
  }
  return out.sort()
}

function readJson(file, problems, where) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    problems.push(`${where}: 读不到文件 — ${error.message}`)
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    problems.push(`${where}: JSON 解析失败 — ${error.message}`)
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    problems.push(`${where}: 顶层必须是一个 JSON 对象`)
    return null
  }
  return parsed
}

/** 皮肤目录内的相对路径解析；越界一律拒绝。 */
function resolveInside(baseDir, relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return null
  if (relPath.startsWith('/') || relPath.includes('://') || relPath.includes('..')) return null
  const target = resolve(baseDir, relPath)
  const normalizedBase = resolve(baseDir)
  if (target !== normalizedBase && !target.startsWith(normalizedBase + sep)) return null
  return target
}

// ---------------------------------------------------------------------------
// 参数 schema
// ---------------------------------------------------------------------------

/** 归一化一个参数声明；非法时记诊断并返回 null。 */
function normalizeParam(raw, where, problems) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push(`${where}: 参数必须是对象`)
    return null
  }
  const key = raw.key
  if (typeof key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key)) {
    problems.push(`${where}: 参数 key 非法（需匹配 ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$）`)
    return null
  }
  const at = `${where}.${key}`
  const type = raw.type
  if (!PARAM_TYPES.has(type)) {
    problems.push(`${at}: 未知类型 "${String(type)}"，可用 ${[...PARAM_TYPES].join(' / ')}`)
    return null
  }

  const param = {
    key,
    type,
    label: str(raw.label, key),
    description: str(raw.description, ''),
    group: str(raw.group, ''),
    unit: str(raw.unit, ''),
    cssVar: typeof raw.cssVar === 'string' && raw.cssVar.startsWith('--') ? raw.cssVar : `--ls-${kebab(key)}`
  }

  if (type === 'number') {
    const min = Number.isFinite(raw.min) ? raw.min : 0
    const max = Number.isFinite(raw.max) ? raw.max : 100
    if (!(max > min)) {
      problems.push(`${at}: max 必须大于 min`)
      return null
    }
    param.min = min
    param.max = max
    param.step = Number.isFinite(raw.step) && raw.step > 0 ? raw.step : (max - min) / 100
  }

  if (type === 'enum') {
    const options = []
    for (const entry of Array.isArray(raw.options) ? raw.options : []) {
      if (typeof entry === 'string') options.push({ value: entry, label: entry })
      else if (entry !== null && typeof entry === 'object' && typeof entry.value === 'string') {
        const option = { value: entry.value, label: str(entry.label, entry.value) }
        // 选项可以自带 CSS 载荷：客户端写变量时用它代替裸值。
        // css 进 <cssVar>，cssDark 进 <cssVar>-dark，于是官方壳层的
        // body[data-ds-dark-theme] 能拿到另一套壁纸。
        if (typeof entry.css === 'string') option.css = entry.css
        if (typeof entry.cssDark === 'string') option.cssDark = entry.cssDark
        options.push(option)
      }
    }
    if (options.length === 0) {
      problems.push(`${at}: enum 至少需要一个 option`)
      return null
    }
    param.options = options
  }

  param.default = coerceValue(param, raw.default)
  return param
}

function normalizeParams(raw, where, problems) {
  const list = []
  const seen = new Set()
  for (const entry of Array.isArray(raw) ? raw : []) {
    const param = normalizeParam(entry, where, problems)
    if (param === null) continue
    if (seen.has(param.key)) {
      problems.push(`${where}: 参数 key "${param.key}" 重复`)
      continue
    }
    seen.add(param.key)
    list.push(param)
  }
  return list
}

/**
 * 值是否落在参数声明的合法域内：数字夹进区间，其余类型严格匹配。
 * 返回 null 表示「不在域内」，由调用方决定兜底成什么。
 */
function clampDomain(param, value) {
  switch (param.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(n) ? Math.min(param.max, Math.max(param.min, n)) : null
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : null
    case 'color':
      return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : null
    case 'enum':
      return param.options.some((option) => option.value === value) ? value : null
    case 'text':
      return typeof value === 'string' ? value : null
    default:
      return null
  }
}

/**
 * 把一个候选值收进合法域：域内的原样返回（数字先夹进区间），域外的回落到
 * **该参数声明的默认值**。只有在归一化默认值本身时（那时 param.default 还没算出来）
 * 才退到类型兜底值。
 *
 * 导出是为了让客户端半边的同名前向实现能与它逐例对齐（见测试台 7b 段）——
 * 两边的收束规则必须一致，否则预览与落盘会出现分歧。
 */
export function coerceValue(param, value) {
  const clamped = clampDomain(param, value)
  if (clamped !== null) return clamped
  if (param.default !== undefined) return param.default
  switch (param.type) {
    case 'number':
      return param.min
    case 'boolean':
      return false
    case 'color':
      return '#888888'
    case 'enum':
      return param.options[0].value
    default:
      return ''
  }
}

/** 大类参数 + 小类参数按 key 合并：小类同 key 覆盖，新 key 追加。 */
function mergeParams(familyParams, variantParams) {
  const merged = familyParams.map((param) => ({ ...param, inherited: true }))
  const index = new Map(merged.map((param, at) => [param.key, at]))
  for (const param of variantParams) {
    const at = index.get(param.key)
    if (at === undefined) {
      merged.push({ ...param, inherited: false })
      index.set(param.key, merged.length - 1)
    } else {
      merged[at] = { ...param, inherited: false }
    }
  }
  return merged
}

function defaultsOf(params) {
  const out = {}
  for (const param of params) out[param.key] = param.default
  return out
}

function normalizePresets(raw, params, where, problems) {
  const byKey = new Map(params.map((param) => [param.key, param]))
  const out = []
  const seen = new Set()
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') {
      problems.push(`${where}: preset 需要字符串 id`)
      continue
    }
    if (seen.has(entry.id)) {
      problems.push(`${where}: preset id "${entry.id}" 重复`)
      continue
    }
    seen.add(entry.id)
    const values = {}
    for (const [key, value] of Object.entries(entry.values && typeof entry.values === 'object' ? entry.values : {})) {
      const param = byKey.get(key)
      if (param === undefined) {
        problems.push(`${where}.${entry.id}: values 里有未声明的参数 "${key}"`)
        continue
      }
      values[key] = coerceValue(param, value)
    }
    out.push({
      id: entry.id,
      name: str(entry.name, entry.id),
      description: str(entry.description, ''),
      values
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// 目录册
// ---------------------------------------------------------------------------

function loadVariant(family, variantDir, variantId, problems) {
  const where = `variant "${family.id}/${variantId}"`
  const raw = readJson(join(variantDir, 'skin.json'), problems, where)
  if (raw === null) return null
  if (raw.manifestVersion !== undefined && raw.manifestVersion !== MANIFEST_VERSION) {
    problems.push(`${where}: manifestVersion ${String(raw.manifestVersion)} 不受支持（当前 ${MANIFEST_VERSION}）`)
    return null
  }

  const ownParams = normalizeParams(raw.params, where, problems)
  const params = mergeParams(family.params, ownParams)

  // 小类可以只改继承参数的默认值（`defaults`），不必把整段 schema 抄一遍。
  // 这是分级的关键：家族定义能力，小类只表达差异。
  const defaultsPatch = raw.defaults !== null && typeof raw.defaults === 'object' && !Array.isArray(raw.defaults) ? raw.defaults : {}
  for (const [key, value] of Object.entries(defaultsPatch)) {
    const param = params.find((entry) => entry.key === key)
    if (param === undefined) {
      problems.push(`${where}.defaults: 没有名为 "${key}" 的参数`)
      continue
    }
    param.default = coerceValue(param, value)
  }
  // 家族级预设与小类级预设按 id 合并，小类同名覆盖。
  const presetIndex = new Map()
  for (const preset of family.presetsRaw) presetIndex.set(preset.id, preset)
  for (const preset of Array.isArray(raw.presets) ? raw.presets : []) {
    if (preset !== null && typeof preset === 'object' && typeof preset.id === 'string') presetIndex.set(preset.id, preset)
  }
  return {
    id: variantId,
    family: family.id,
    origin: family.origin,
    dir: variantDir,
    name: str(raw.name, variantId),
    nameEn: str(raw.nameEn, ''),
    description: str(raw.description, ''),
    accent: str(raw.accent, family.accent),
    tags: strArray(raw.tags),
    hidden: raw.hidden === true,
    ownParams,
    params,
    defaults: defaultsOf(params),
    presets: normalizePresets([...presetIndex.values()], params, where, problems),
    styles: strArray(raw.styles),
    css: typeof raw.css === 'string' ? raw.css : ''
  }
}

function loadFamily(familyDir, familyId, origin, problems) {
  const where = `family "${familyId}" (${origin})`
  const raw = readJson(join(familyDir, 'family.json'), problems, where)
  if (raw === null) return null
  if (raw.manifestVersion !== undefined && raw.manifestVersion !== MANIFEST_VERSION) {
    problems.push(`${where}: manifestVersion ${String(raw.manifestVersion)} 不受支持（当前 ${MANIFEST_VERSION}）`)
    return null
  }

  const family = {
    id: familyId,
    origin,
    dir: familyDir,
    name: str(raw.name, familyId),
    nameEn: str(raw.nameEn, ''),
    description: str(raw.description, ''),
    accent: str(raw.accent, ''),
    category: str(raw.category, ''),
    // 同一个分类内的排序键。缺省给一个很大的值，让它落到该分类末尾而不是乱插。
    order: Number.isFinite(raw.order) ? raw.order : Number.MAX_SAFE_INTEGER,
    tags: strArray(raw.tags),
    hidden: raw.hidden === true,
    params: normalizeParams(raw.params, where, problems),
    presetsRaw: (Array.isArray(raw.presets) ? raw.presets : []).filter(
      (preset) => preset !== null && typeof preset === 'object' && typeof preset.id === 'string'
    ),
    styles: strArray(raw.styles),
    css: typeof raw.css === 'string' ? raw.css : '',
    variants: []
  }

  for (const variantId of listDirs(familyDir, new Set(['assets', 'preview']))) {
    if (!existsSync(join(familyDir, variantId, 'skin.json'))) continue
    const variant = loadVariant(family, join(familyDir, variantId), variantId, problems)
    if (variant !== null) family.variants.push(variant)
  }
  if (family.variants.length === 0) {
    problems.push(`${where}: 没有任何含 skin.json 的小类目录`)
  }
  // 分类是面板分组与排序的依据：漏了或写错就会让家族混进别的行里，
  // 所以当作错误报出来，而不是让它悄悄落到「未分类」。
  if (!CATEGORY_NAMES.includes(family.category)) {
    problems.push(`${where}: 家族 "${familyId}" 的 category 是 ${JSON.stringify(family.category)}，`
      + `必须是 ${CATEGORY_NAMES.map((c) => `"${c}"`).join(' / ')} 之一`)
  }
  if (!Number.isFinite(raw.order)) {
    problems.push(`${where}: 家族 "${familyId}" 缺 order（同一分类内的排序键）——`
      + '没有它就只能落到该分类末尾，面板顺序会与设计不符')
  }
  return family
}

/**
 * 汇总两个根下的全部皮肤。用户根的同一 familyId 覆盖内置根，这是唯一的
 * 覆盖规则；同名小类不做深合并——覆盖就是整体替换，避免出现第三种来源不明的层。
 */
export function loadCatalog() {
  const problems = []
  const families = new Map()

  for (const { origin, dir } of [{ origin: 'builtin', dir: BUILTIN_SKINS_DIR }, { origin: 'user', dir: userSkinsDir() }]) {
    if (!existsSync(dir)) continue
    for (const familyId of listDirs(dir, new Set())) {
      const family = loadFamily(join(dir, familyId), familyId, origin, problems)
      if (family !== null) families.set(familyId, family)
    }
  }

  // 排序键是「分类 → 类内顺序 → id」：分类的行序由 CATEGORIES 给出，
  // 类内顺序由每个家族的 order 给出（光谱轴序 / 血缘年代序 / 种族序），
  // id 只是最后用来消歧的。
  const ordered = [...families.values()].sort((left, right) => {
    const byCategory = CATEGORY_NAMES.indexOf(left.category) - CATEGORY_NAMES.indexOf(right.category)
    if (byCategory !== 0) return byCategory
    if (left.order !== right.order) return left.order - right.order
    return left.id.localeCompare(right.id)
  })

  // 给每个小类标注它在亮/暗两档分别画出来的是亮色还是暗色。
  // 这是**推导**出来的（读它自己的 CSS），不是手写声明 —— 手写的「支持亮色/暗色」
  // 一旦皮肤改了就会漂移，而面板显示的正是用户据以判断的那句话。
  for (const family of ordered) {
    for (const variant of family.variants) {
      // 只为分析借用一次组合结果；诊断不在这里报，取样式时还会再报一次。
      variant.appearance = analyzeAppearance(composeSkinCss(family, variant).css)
    }
  }
  return { families: ordered, diagnostics: problems }
}

/** 在目录册结果里定位一个小类。 */
export function findVariant(catalog, familyId, variantId) {
  const family = catalog.families.find((entry) => entry.id === familyId)
  if (family === undefined) return null
  const variant = family.variants.find((entry) => entry.id === variantId)
  if (variant === undefined) return null
  return { family, variant }
}

// ---------------------------------------------------------------------------
// CSS 层叠
// ---------------------------------------------------------------------------

function readStyleFile(baseDir, relPath, problems, where) {
  const file = resolveInside(baseDir, relPath)
  if (file === null) {
    problems.push(`${where}: 样式路径 "${relPath}" 越出皮肤目录`)
    return ''
  }
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    problems.push(`${where}: 读不到样式 "${relPath}" — ${error.message}`)
    return ''
  }
}

/**
 * 家族层在前、小类层在后，最后是各自的 inline css。
 * 层叠顺序就是覆盖顺序：小类天然压过大类，无需任何工具链。
 */
export function composeSkinCss(family, variant) {
  const problems = []
  const chunks = []
  for (const relPath of family.styles) {
    const text = readStyleFile(family.dir, relPath, problems, `family "${family.id}"`)
    if (text.length > 0) chunks.push({ source: `${family.id}/${relPath}`, text })
  }
  if (family.css.length > 0) chunks.push({ source: `${family.id}/family.json#css`, text: family.css })
  for (const relPath of variant.styles) {
    const text = readStyleFile(variant.dir, relPath, problems, `variant "${family.id}/${variant.id}"`)
    if (text.length > 0) chunks.push({ source: `${family.id}/${variant.id}/${relPath}`, text })
  }
  if (variant.css.length > 0) chunks.push({ source: `${family.id}/${variant.id}/skin.json#css`, text: variant.css })

  const header = [
    `/* LiveSkin — ${family.id}/${variant.id} (${variant.name})`,
    ...chunks.map((chunk) => ` * layer: ${chunk.source}`),
    ' */',
    ''
  ].join('\n')
  return { css: header + chunks.map((chunk) => chunk.text).join('\n\n'), diagnostics: problems }
}

// ---------------------------------------------------------------------------
// 状态文档
// ---------------------------------------------------------------------------

function emptyState() {
  return { version: MANIFEST_VERSION, active: null, values: {}, presets: {}, prefs: {} }
}

function normalizeState(raw) {
  const state = emptyState()
  if (raw === null || typeof raw !== 'object') return state
  if (typeof raw.active === 'string' && /^[^/]+\/[^/]+$/.test(raw.active)) state.active = raw.active
  if (raw.values !== null && typeof raw.values === 'object' && !Array.isArray(raw.values)) {
    for (const [key, value] of Object.entries(raw.values)) {
      if (/^[^/]+\/[^/]+$/.test(key) && value !== null && typeof value === 'object' && !Array.isArray(value)) {
        state.values[key] = { ...value }
      }
    }
  }
  if (raw.presets !== null && typeof raw.presets === 'object' && !Array.isArray(raw.presets)) {
    for (const [key, value] of Object.entries(raw.presets)) {
      if (/^[^/]+\/[^/]+$/.test(key) && typeof value === 'string') state.presets[key] = value
    }
  }
  if (raw.prefs !== null && typeof raw.prefs === 'object' && !Array.isArray(raw.prefs)) {
    for (const [key, value] of Object.entries(raw.prefs)) {
      if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') state.prefs[key] = value
    }
  }
  return state
}

/** 读状态；文件缺失或损坏一律回落到空状态，绝不抛。 */
export function readState() {
  const file = statePath()
  if (!existsSync(file)) return emptyState()
  try {
    return normalizeState(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return emptyState()
  }
}

/** 原子写状态（同目录 tmp → rename）。 */
export function writeState(next) {
  const file = statePath()
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `.state.${process.pid}.${Date.now()}.tmp`)
  const state = normalizeState(next)
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    renameSync(tmp, file)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
  return state
}

/**
 * 把小类的参数声明与状态值合起来，得到「这一刻真正生效」的取值。
 * 状态里出现的未知 key 会被丢弃，非法值一律夹回合法域。
 */
export function resolveValues(variant, stored) {
  const values = {}
  for (const param of variant.params) {
    const raw = stored !== undefined && Object.prototype.hasOwnProperty.call(stored, param.key) ? stored[param.key] : param.default
    values[param.key] = coerceValue(param, raw)
  }
  return values
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** 同源围栏：写操作只接受同源请求。 */
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    try {
      if (new URL(origin).host !== req.headers.host) return false
    } catch {
      return false
    }
  }
  return true
}

function send(req, res, status, contentType, body) {
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  if (req.method === 'HEAD') res.end()
  else res.end(payload)
}

function sendJson(req, res, status, value) {
  send(req, res, status, 'application/json; charset=utf-8', JSON.stringify(value))
}

async function readJsonBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求体必须是 JSON 对象')
  return parsed
}

/** 目录册的对外投影：只放客户端需要的东西，不带任何宿主路径。 */
function projectCatalog(catalog, state) {
  return {
    ok: true,
    apiVersion: MANIFEST_VERSION,
    // 面板标题上会显示它，用户一眼能对上是哪一版。
    version: VERSION,
    // 分类与行序由宿主给出；面板按它把家族分成几行。
    categories: CATEGORIES,
    active: state.active,
    families: catalog.families.filter((family) => !family.hidden).map((family) => ({
      id: family.id,
      name: family.name,
      description: family.description,
      accent: family.accent,
      category: family.category,
      order: family.order,
      tags: family.tags,
      params: family.params,
      variants: family.variants.filter((variant) => !variant.hidden).map((variant) => ({
        id: variant.id,
        name: variant.name,
        description: variant.description,
        accent: variant.accent,
        tags: variant.tags,
        params: variant.params,
        defaults: variant.defaults,
        presets: variant.presets,
        // 面板要靠它标出「这一支在亮/暗两档分别是什么样」。宿主推导，客户端只显示。
        appearance: variant.appearance
      }))
    })),
    diagnostics: catalog.diagnostics
  }
}

function parseSkinPath(pathname) {
  const rest = pathname.slice(`${API_PREFIX}/skin/`.length)
  const parts = rest.split('/')
  if (parts.length < 3) return null
  return {
    familyId: decodeURIComponent(parts[0]),
    variantId: decodeURIComponent(parts[1]),
    tail: parts.slice(2).map((part) => decodeURIComponent(part))
  }
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.pathname
  const method = req.method ?? 'GET'

  if (!pathname.startsWith(API_PREFIX)) {
    sendJson(req, res, 404, { ok: false, error: 'not-found' })
    return
  }
  const route = pathname.slice(API_PREFIX.length) || '/'

  if (route === '/health') {
    sendJson(req, res, 200, {
      ok: true,
      name,
      apiVersion: MANIFEST_VERSION,
      version: VERSION,
      builtinSkinsDir: BUILTIN_SKINS_DIR,
      userSkinsDir: userSkinsDir(),
      // 宿主半边的源文件清单与内容哈希：验收台拿它判断「线上宿主是不是旧的」。
      loadedAt: LOADED_AT,
      hostSources: HOST_SOURCES,
      sourcesHash: SOURCES_HASH
    })
    return
  }

  if (route === '/catalog' && method === 'GET') {
    sendJson(req, res, 200, projectCatalog(loadCatalog(), readState()))
    return
  }

  if (route === '/state' && method === 'GET') {
    const catalog = loadCatalog()
    const state = readState()
    const resolved = {}
    for (const [key, stored] of Object.entries(state.values)) {
      const [familyId, variantId] = key.split('/')
      const found = findVariant(catalog, familyId, variantId)
      if (found !== null) resolved[key] = resolveValues(found.variant, stored)
    }
    sendJson(req, res, 200, { ok: true, state, resolved })
    return
  }

  if (route === '/state' && method === 'POST') {
    if (!sameOrigin(req)) {
      sendJson(req, res, 403, { ok: false, error: 'cross-origin' })
      return
    }
    let patch
    try {
      patch = await readJsonBody(req, 512 * 1024)
    } catch (error) {
      sendJson(req, res, 400, { ok: false, error: error.message })
      return
    }
    const catalog = loadCatalog()
    const current = readState()

    if ('active' in patch) {
      if (patch.active === null) current.active = null
      else if (typeof patch.active === 'string' && /^[^/]+\/[^/]+$/.test(patch.active)) {
        const [familyId, variantId] = patch.active.split('/')
        if (findVariant(catalog, familyId, variantId) === null) {
          sendJson(req, res, 404, { ok: false, error: `未安装的皮肤 "${patch.active}"` })
          return
        }
        current.active = patch.active
      } else {
        sendJson(req, res, 400, { ok: false, error: 'active 必须是 "<family>/<variant>" 或 null' })
        return
      }
    }

    if (patch.values !== undefined) {
      const key = typeof patch.skin === 'string' ? patch.skin : current.active
      if (key === null) {
        sendJson(req, res, 400, { ok: false, error: 'values 需要一个 skin 目标（或先设置 active）' })
        return
      }
      const [familyId, variantId] = key.split('/')
      const found = findVariant(catalog, familyId, variantId)
      if (found === null) {
        sendJson(req, res, 404, { ok: false, error: `未安装的皮肤 "${key}"` })
        return
      }
      current.values[key] = resolveValues(found.variant, { ...(current.values[key] ?? {}), ...patch.values })
    }

    if (patch.preset !== undefined) {
      const key = typeof patch.skin === 'string' ? patch.skin : current.active
      if (key === null) {
        sendJson(req, res, 400, { ok: false, error: 'preset 需要一个 skin 目标' })
        return
      }
      const [familyId, variantId] = key.split('/')
      const found = findVariant(catalog, familyId, variantId)
      if (found === null) {
        sendJson(req, res, 404, { ok: false, error: `未安装的皮肤 "${key}"` })
        return
      }
      if (patch.preset === null) {
        delete current.presets[key]
      } else {
        const preset = found.variant.presets.find((entry) => entry.id === patch.preset)
        if (preset === undefined) {
          sendJson(req, res, 404, { ok: false, error: `小类 "${key}" 没有预设 "${String(patch.preset)}"` })
          return
        }
        current.presets[key] = preset.id
        current.values[key] = resolveValues(found.variant, { ...(current.values[key] ?? {}), ...preset.values })
      }
    }

    if (patch.prefs !== undefined && patch.prefs !== null && typeof patch.prefs === 'object') {
      current.prefs = { ...current.prefs, ...patch.prefs }
    }

    const saved = writeState(current)
    sendJson(req, res, 200, { ok: true, state: saved })
    return
  }

  if (route.startsWith('/skin/') && method === 'GET') {
    const parsed = parseSkinPath(pathname)
    if (parsed === null) {
      sendJson(req, res, 400, { ok: false, error: 'malformed-skin-path' })
      return
    }
    const catalog = loadCatalog()
    const found = findVariant(catalog, parsed.familyId, parsed.variantId)
    if (found === null) {
      sendJson(req, res, 404, { ok: false, error: `未安装的皮肤 "${parsed.familyId}/${parsed.variantId}"` })
      return
    }
    const [head, ...rest] = parsed.tail

    if (head === 'css' && rest.length === 0) {
      const composed = composeSkinCss(found.family, found.variant)
      if (composed.diagnostics.length > 0) {
        sendJson(req, res, 500, { ok: false, error: 'style-layer-error', diagnostics: composed.diagnostics })
        return
      }
      send(req, res, 200, 'text/css; charset=utf-8', composed.css)
      return
    }

    if (head === 'asset' && rest.length > 0) {
      const file = resolveInside(join(found.variant.dir, 'assets'), rest.join('/'))
      if (file === null || !existsSync(file) || !statSync(file).isFile()) {
        sendJson(req, res, 404, { ok: false, error: 'asset-not-found' })
        return
      }
      const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
      const types = {
        css: 'text/css; charset=utf-8',
        svg: 'image/svg+xml',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
        json: 'application/json; charset=utf-8'
      }
      send(req, res, 200, types[ext] ?? 'application/octet-stream', readFileSync(file))
      return
    }

    sendJson(req, res, 404, { ok: false, error: 'unknown-skin-endpoint' })
    return
  }

  sendJson(req, res, 404, { ok: false, error: 'not-found' })
}

/**
 * 插件体：只注册一条 prefix 路由，内部再分派。
 * @param ctx - 宿主 cordis 上下文。
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: (req, res) => {
      Promise.resolve(handle(req, res)).catch((error) => {
        try {
          sendJson(req, res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        } catch {
          /* 响应已经开始，无法再改状态码 */
        }
      })
    }
  }), 'live-skin: api routes')

  ctx.logger?.info?.(`LiveSkin 已挂载：${API_PREFIX}`)
}
