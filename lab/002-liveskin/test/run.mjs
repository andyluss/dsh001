/**
 * LiveSkin 自带测试台。
 *
 * 宿主半边：把插件装进一个假 ctx（只实现它用到的 effect / webServer / logger），
 * 拿它注册的路由开一个真 node:http 服务，然后逐个打接口。
 * 客户端半边：把 __ModuleLoader__ bundle 物化，检查导出与 slots 注册。
 *
 * 用法： node run.mjs
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { strict as assert } from 'node:assert'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..', 'plugin')

// 测试自己的 harness home：放在工作区内，既不用碰真实 $DSH_HOME，
// 也不受文件沙箱限制。插件在调用时读 process.env.DSH_HOME，所以这里设了就生效。
const TEST_HOME = join(HERE, '.home')
rmSync(TEST_HOME, { recursive: true, force: true })
mkdirSync(TEST_HOME, { recursive: true })
process.env.DSH_HOME = TEST_HOME

/** 同源写：Origin 是 fetch 的禁止头，所以围栏用 sec-fetch-site 验证。 */
const JSON_HEADERS = { 'content-type': 'application/json' }

let failures = 0
function check(label, fn) {
  try {
    fn()
    console.log(`  \u2713 ${label}`)
  } catch (error) {
    failures += 1
    console.log(`  \u2717 ${label}\n      ${error.message}`)
  }
}

async function checkAsync(label, fn) {
  try {
    await fn()
    console.log(`  \u2713 ${label}`)
  } catch (error) {
    failures += 1
    console.log(`  \u2717 ${label}\n      ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// 1. 宿主半边
// ---------------------------------------------------------------------------

console.log('\n[1] 宿主半边')

const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'))
const plugin = await import(join(PKG, 'lib', 'index.js'))

check('清单声明与插件名一致', () => {
  assert.equal(pkg.name, 'dsh-live-skin')
  assert.equal(plugin.name, 'dsh-live-skin')
  assert.deepEqual(plugin.inject, ['webServer'])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['./client'], './lib/client.js')
})

const routes = []
const effects = []
const fakeCtx = {
  effect(callback) {
    const dispose = callback()
    if (typeof dispose === 'function') effects.push(dispose)
    return () => {}
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    }
  },
  logger: { info() {}, warn() {} }
}

check('apply() 注册了一条 prefix 路由', () => {
  plugin.apply(fakeCtx)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/api/live-skin/v1')
})

// 起真服务
const server = createServer((req, res) => {
  const route = routes.find((entry) => (req.url ?? '').startsWith(entry.path))
  if (route === undefined) {
    res.writeHead(404).end('no route')
    return
  }
  Promise.resolve(route.handler(req, res)).catch((error) => {
    res.writeHead(500).end(String(error))
  })
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${String(server.address().port)}/api/live-skin/v1`

const catalog = await (await fetch(`${base}/catalog`)).json()

console.log('\n[2] 目录册 / 分级模型')

check('内置家族被收录，且无诊断', () => {
  assert.deepEqual(catalog.diagnostics, [], `诊断：${JSON.stringify(catalog.diagnostics)}`)
  const ids = catalog.families.map((family) => family.id)
  assert.ok(ids.includes('FrutigerAeroFamily'), `实际家族：${ids.join(', ')}`)
})

check('家族下挂着三个小类', () => {
  const family = catalog.families.find((entry) => entry.id === 'FrutigerAeroFamily')
  const variants = family.variants.map((variant) => variant.id).sort()
  assert.deepEqual(variants, ['AeroGlass', 'DarkAero', 'FrutigerAero'])
})

const family = catalog.families.find((entry) => entry.id === 'FrutigerAeroFamily')
const day = family.variants.find((variant) => variant.id === 'FrutigerAero')
const dark = family.variants.find((variant) => variant.id === 'DarkAero')

check('小类继承家族全部 8 个参数', () => {
  assert.equal(day.params.length, 8)
  const keys = day.params.map((param) => param.key).sort()
  assert.deepEqual(keys, ['accent', 'blur', 'bubbleAmount', 'bubbleCycle', 'bubbles', 'glass', 'gloss', 'wallpaper'])
})

check('参数带上了默认 CSS 变量名（camelCase → --ls-kebab）', () => {
  const bubble = day.params.find((param) => param.key === 'bubbleAmount')
  const glass = day.params.find((param) => param.key === 'glass')
  assert.equal(bubble.cssVar, '--ls-bubble-amount')
  assert.equal(glass.cssVar, '--ls-glass')
  assert.equal(glass.unit, '')
  assert.equal(day.params.find((param) => param.key === 'blur').unit, 'px')
})

check('小类 defaults 覆盖了继承默认值而不必重抄 schema', () => {
  assert.equal(day.defaults.wallpaper, 'sky')
  assert.equal(day.defaults.accent, '#0f7fc4')
  assert.equal(dark.defaults.wallpaper, 'deep')
  assert.equal(dark.defaults.accent, '#35c6f0')
  assert.equal(dark.defaults.glass, 66)
})

check('家族预设与小类预设按 id 合并（小类覆盖同名）', () => {
  const dayIds = day.presets.map((preset) => preset.id)
  assert.deepEqual(dayIds, ['calm', 'standard', 'rich'])
  const darkStandard = dark.presets.find((preset) => preset.id === 'standard')
  assert.equal(darkStandard.name, '标准（夜光）')
  assert.equal(darkStandard.values.glass, 66)
  // 家族预设仍然在：小类只覆盖了 standard，calm/rich 保留
  assert.ok(dark.presets.some((preset) => preset.id === 'calm'))
})

check('enum 选项携带 CSS 载荷（含 -dark 变体）', () => {
  const wallpaper = day.params.find((param) => param.key === 'wallpaper')
  assert.ok(wallpaper.options.length >= 4)
  const sky = wallpaper.options.find((option) => option.value === 'sky')
  assert.ok(sky.css.includes('linear-gradient'), 'sky 选项缺少 css 载荷')
  assert.ok(sky.cssDark.includes('linear-gradient'), 'sky 选项缺少 cssDark 载荷')
  assert.equal(wallpaper.options.find((option) => option.value === 'plain').css, 'none')
})

console.log('\n[3] 样式层叠')

const cssResponse = await fetch(`${base}/skin/FrutigerAeroFamily/DarkAero/css`)
const css = await cssResponse.text()

await checkAsync('CSS 以 text/css 提供', async () => {
  assert.equal(cssResponse.headers.get('content-type'), 'text/css; charset=utf-8')
  assert.equal(cssResponse.headers.get('cache-control'), 'no-store')
})

check('层叠顺序：家族层在前，小类层在后', () => {
  const familyAt = css.indexOf('base.css')
  const variantAt = css.indexOf('DarkAero/skin.css')
  assert.ok(familyAt >= 0, '缺少家族层标注')
  assert.ok(variantAt >= 0, '缺少小类层标注')
  assert.ok(familyAt < variantAt, '家族层必须排在小类层之前')
  // 小类层里强制深色的规则确实排在家族层之后，因此生效
  assert.ok(css.lastIndexOf('--dsw-alias-label-primary') > familyAt)
})

// 「选择器作用域」的检查已移入 [5b]，改为遍历全部 variant
// —— 原来的版本只看一份 CSS，且没处理关键帧里的百分比节点行。

await checkAsync('路径穿越被拒', async () => {
  const response = await fetch(`${base}/skin/FrutigerAeroFamily/DarkAero/asset/..%2f..%2f..%2fetc/passwd`)
  assert.equal(response.status, 404)
})

console.log('\n[4] 状态持久化')

const initial = await (await fetch(`${base}/state`)).json()
check('初始状态为空且形状完整', () => {
  assert.equal(initial.ok, true)
  assert.equal(initial.state.active, null)
  assert.deepEqual(initial.state.values, {})
})

const applied = await (await fetch(`${base}/state`, {
  method: 'POST',
  headers: JSON_HEADERS,
  body: JSON.stringify({ active: 'FrutigerAeroFamily/DarkAero', skin: 'FrutigerAeroFamily/DarkAero', values: { glass: 90, accent: '#ff0000', bubbles: false } })
})).json()

await checkAsync('应用一套皮肤并落盘', async () => {
  assert.equal(applied.ok, true)
  assert.equal(applied.state.active, 'FrutigerAeroFamily/DarkAero')
  assert.equal(applied.state.values['FrutigerAeroFamily/DarkAero'].glass, 90)
  assert.equal(applied.state.values['FrutigerAeroFamily/DarkAero'].accent, '#ff0000')
  assert.equal(applied.state.values['FrutigerAeroFamily/DarkAero'].bubbles, false)
})

await checkAsync('越界参数值被夹回合法域，未知 key 被丢弃', async () => {
  const response = await (await fetch(`${base}/state`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      skin: 'FrutigerAeroFamily/DarkAero',
      values: { glass: 9999, blur: -5, accent: 'not-a-color', wallpaper: 'nope', bogus: 1 }
    })
  })).json()
  const values = response.state.values['FrutigerAeroFamily/DarkAero']
  assert.equal(values.glass, 100, 'glass 应被夹到上限')
  assert.equal(values.blur, 0, 'blur 应被夹到下限')
  assert.equal(values.accent, '#35c6f0', '非法颜色应回落到该参数的默认值')
  assert.equal(values.wallpaper, 'deep', '非法 enum 应回落到默认')
  assert.equal(values.bogus, undefined, '未声明的 key 应被丢弃')
})

await checkAsync('未安装的皮肤被拒', async () => {
  const response = await fetch(`${base}/state`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ active: 'NoSuchFamily/NoSuchVariant' })
  })
  assert.equal(response.status, 404)
})

await checkAsync('跨站写被拒（同源围栏）', async () => {
  const response = await fetch(`${base}/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify({ active: null })
  })
  assert.equal(response.status, 403)
})

await checkAsync('应用预设会同时写入参数值', async () => {
  const response = await (await fetch(`${base}/state`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ skin: 'FrutigerAeroFamily/DarkAero', preset: 'calm' })
  })).json()
  assert.equal(response.state.presets['FrutigerAeroFamily/DarkAero'], 'calm')
  assert.equal(response.state.values['FrutigerAeroFamily/DarkAero'].glass, 74)
})

// ---------------------------------------------------------------------------
// 5. 皮肤 linter
// ---------------------------------------------------------------------------

console.log('\n[5] 皮肤 linter')

const lintCatalog = plugin.loadCatalog()

const allVariants = lintCatalog.families.flatMap((family) =>
  family.variants.map((variant) => ({ family, variant }))
)

check('每套皮肤都能推导出「亮/暗两档分别是什么样」，且与已知事实一致', () => {
  // 面板上那句「亮 / 暗 跟随系统」是用户据以判断「切到暗色会不会变样」的，
  // 它由宿主读皮肤自己的 CSS 推导。这里把已知事实钉住，防止推导悄悄退化。
  const all = lintCatalog.families.flatMap((family) => family.variants.map((v) => ({ family: family.id, v })))
  const unknown = all.filter(({ v }) => v.appearance === undefined
    || v.appearance.light === null || v.appearance.dark === null)
  assert.deepEqual(unknown.map((x) => `${x.family}/${x.v.id}`), [], '有皮肤推导不出档位')

  const label = (a) => (a.followsSystem ? `${a.light}/${a.dark}` : `仅${a.light}`)
  const got = Object.fromEntries(all.map(({ family, v }) => [`${family}/${v.id}`, label(v.appearance)]))
  const expected = {
    // 亮色默认 + 暗色覆盖
    'FrutigerAeroFamily/FrutigerAero': 'light/dark',
    'AtompunkFamily/SpaceAge': 'light/dark',
    'SolarpunkFamily/Dawnlight': 'light/dark',
    'CassetteFuturismFamily/ControlRoom': 'light/dark',
    // 强制单一观感的变体：无论系统在哪一档都是同一套观感
    'FrutigerAeroFamily/DarkAero': '仅dark',
    'SolarpunkFamily/Overgrown': '仅dark',
    'BiopunkFamily/Cleanroom': '仅light',
    'CassetteFuturismFamily/BeigeTerminal': '仅light',
    // 暗色默认的家族：两档都是暗色
    'SteampunkFamily/Brassworks': '仅dark',
    'DieselpunkFamily/NoirRain': '仅dark',
    'CyberpunkFamily/MegacityNight': '仅dark'
  }
  const wrong = Object.entries(expected).filter(([key, want]) => got[key] !== want)
    .map(([key, want]) => `${key}: 期望 ${want}，实际 ${got[key]}`)
  assert.deepEqual(wrong, [], wrong.join('\n'))
})

check('三个小类都在册，且整个目录册零诊断', () => {
  const ids = lintCatalog.families
    .find((family) => family.id === 'FrutigerAeroFamily')
    .variants.map((variant) => variant.id)
    .sort()
  assert.deepEqual(ids, ['AeroGlass', 'DarkAero', 'FrutigerAero'])
  assert.deepEqual(lintCatalog.diagnostics, [], `诊断：\n${lintCatalog.diagnostics.join('\n')}`)
})

check('每个参数的 cssVar 都在 --ls- 命名空间下，且同一小类内不重复', () => {
  for (const { family, variant } of allVariants) {
    const seen = new Map()
    for (const param of variant.params) {
      assert.ok(param.cssVar.startsWith('--ls-'), `${family.id}/${variant.id}.${param.key} → ${param.cssVar}`)
      const prior = seen.get(param.cssVar)
      assert.equal(prior, undefined, `${family.id}/${variant.id}: ${param.cssVar} 被 ${prior} 和 ${param.key} 同时声明`)
      seen.set(param.cssVar, param.key)
    }
  }
})

check('CSS 引用的每个 --ls-* 都有出处（参数 / 参数派生 / 本地声明）', () => {
  const problems = []
  for (const { family, variant } of allVariants) {
    const composed = plugin.composeSkinCss(family, variant)
    assert.deepEqual(composed.diagnostics, [], `层叠诊断：${composed.diagnostics.join('; ')}`)

    const available = new Set()
    for (const param of variant.params) {
      available.add(param.cssVar)
      // enum 选项带 cssDark 时，客户端会额外写一个 <cssVar>-dark
      if (param.type === 'enum' && param.options.some((option) => typeof option.cssDark === 'string')) {
        available.add(`${param.cssVar}-dark`)
      }
    }
    // CSS 自己声明的中间量也算有出处
    for (const match of composed.css.matchAll(/(--ls-[a-z0-9-]+)\s*:/g)) available.add(match[1])

    for (const match of composed.css.matchAll(/var\((--ls-[a-z0-9-]+)/g)) {
      if (!available.has(match[1])) problems.push(`${family.id}/${variant.id}: var(${match[1]}) 没有任何出处`)
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'))
})

check('声明 --dsw-* 的规则必须落在 body 上，否则被官方调色板盖住', () => {
  // 官方调色板声明在 body 上。皮肤若把 --dsw-* 声明在 html（哪怕是更具体的
  // html[data-live-skin]）上，用 token 的元素会从更近的祖先 body 继承到官方值，
  // 皮肤静默失效 —— 只有不经 token 的规则（如 body::after 的气泡）还生效。
  const problems = []
  for (const { family, variant } of allVariants) {
    const clean = plugin.composeSkinCss(family, variant).css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1].trim().replace(/\s+/g, ' ')
      if (selector.startsWith('@')) continue
      if (!/--dsw-[a-z0-9-]+\s*:/.test(match[2])) continue
      // 必须逐个拆开逗号列表来判断：`html[data-live-skin], …body[…]` 这种写法里
      // 只有后半段落在 body 上，前半段是漏的 —— 整串匹配会把这种漏判放过。
      for (const one of selector.split(',')) {
        const part = one.trim()
        if (part.length === 0) continue
        if (!/(^|[\s>+~])body\b/.test(part)) {
          problems.push(`${family.id}/${variant.id}: "${part.slice(0, 70)}" 声明了 --dsw-* 却没落在 body 上，会被官方调色板盖住`)
        }
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'))
})

check('没有死旋钮：每个参数都真的被 CSS 用到', () => {
  const dead = []
  for (const { family, variant } of allVariants) {
    const composed = plugin.composeSkinCss(family, variant)
    for (const param of variant.params) {
      if (!composed.css.includes(`var(${param.cssVar}`)) {
        dead.push(`${family.id}/${variant.id}: 参数 ${param.key} (${param.cssVar}) 在 CSS 里从未被引用`)
      }
    }
  }
  assert.deepEqual(dead, [], dead.join('\n'))
})

check('预设的每个 key 都能落到一个已声明的参数上', () => {
  for (const { family, variant } of allVariants) {
    const keys = new Set(variant.params.map((param) => param.key))
    for (const preset of variant.presets) {
      for (const key of Object.keys(preset.values)) {
        assert.ok(keys.has(key), `${family.id}/${variant.id} 预设 ${preset.id} 指向未声明的参数 ${key}`)
      }
    }
  }
})

check('enum 选项都带非空 CSS 载荷，且 cssDark 成对出现', () => {
  for (const { family, variant } of allVariants) {
    for (const param of variant.params.filter((entry) => entry.type === 'enum')) {
      for (const option of param.options) {
        assert.ok(typeof option.css === 'string' && option.css.trim().length > 0,
          `${family.id}/${variant.id}.${param.key} 选项 ${option.value} 缺少 css`)
        if (option.cssDark !== undefined) {
          assert.ok(typeof option.cssDark === 'string' && option.cssDark.trim().length > 0,
            `${family.id}/${variant.id}.${param.key} 选项 ${option.value} 的 cssDark 为空`)
        }
      }
    }
  }
})

check('每个小类都带自己的样式层（不能只是大类的复制）', () => {
  for (const { family, variant } of allVariants) {
    assert.ok(variant.styles.length > 0 || variant.css.length > 0,
      `${family.id}/${variant.id} 没有任何自己的样式层`)
  }
})

// ---------------------------------------------------------------------------
// 5a. 物化客户端 bundle（5b 的对比度检查与第 6 段共用同一份模块）
// ---------------------------------------------------------------------------

console.log('\n[5a] 物化客户端 bundle')

const clientSource = readFileSync(join(PKG, 'lib', 'client.js'), 'utf8')

let loaded = null
const fakeWindow = { __ModuleLoader__: { load(entry) { loaded = entry } } }
new Function('window', clientSource)(fakeWindow)

const fakeReact = {
  createElement: (...args) => ({ type: args[0], props: args[1], children: args.slice(2) }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useCallback: (fn) => fn
}

const clientModule = loaded.factory((spec) => {
  if (spec === 'react') return fakeReact
  throw new Error(`客户端 bundle require 了未声明的外部模块：${spec}`)
})

// ---------------------------------------------------------------------------
// 5b. CSS 审计（工程约束 C5–C8 + 可静态解算的 C4）
// ---------------------------------------------------------------------------

console.log('\n[5b] CSS 审计')

/** 剥掉注释后按「选择器 { 声明体 }」切出全部规则。 */
function cssRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].replace(/\s+/g, ' ').trim(),
    body: match[2]
  }))
}

function composedCssOf(family, variant) {
  return plugin.composeSkinCss(family, variant).css
}

/** 按括号深度剔掉指定 at-rule 的整块（含嵌套），避免关键帧里的百分比节点被当成选择器。 */
function stripAtBlocks(css, names) {
  let out = ''
  let at = 0
  for (;;) {
    let hit = -1
    for (const name of names) {
      const found = css.indexOf(name, at)
      if (found >= 0 && (hit < 0 || found < hit)) hit = found
    }
    if (hit < 0) {
      out += css.slice(at)
      return out
    }
    out += css.slice(at, hit)
    const open = css.indexOf('{', hit)
    if (open < 0) return out
    let depth = 0
    let cursor = open
    for (; cursor < css.length; cursor += 1) {
      if (css[cursor] === '{') depth += 1
      else if (css[cursor] === '}') {
        depth -= 1
        if (depth === 0) {
          cursor += 1
          break
        }
      }
    }
    at = cursor
  }
}

check('C2 · 每个选择器都限定在 html[data-live-skin] 之下', () => {
  const problems = []
  for (const { family, variant } of allVariants) {
    const css = composedCssOf(family, variant).replace(/\/\*[\s\S]*?\*\//g, '')
    const scoped = stripAtBlocks(css, ['@keyframes'])
    for (const rule of scoped.matchAll(/([^{}]+)\{/g)) {
      const selector = rule[1].replace(/\s+/g, ' ').trim()
      if (selector.length === 0 || selector.includes('html[data-live-skin]')) continue
      problems.push(`${family.id}/${variant.id}: "${selector.slice(0, 70)}"`)
    }
  }
  assert.deepEqual(problems, [], `泄漏的选择器：\n${problems.join('\n')}`)
})

check('C5 · @keyframes 只动 transform 与 opacity', () => {
  const allowed = new Set(['transform', 'opacity'])
  const problems = []
  for (const { family, variant } of allVariants) {
    const css = composedCssOf(family, variant).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const block of css.matchAll(/@keyframes[\w\s-]*\{([\s\S]*?)\n\}/g)) {
      for (const decl of block[1].matchAll(/([a-z-]+)\s*:/g)) {
        if (!allowed.has(decl[1])) problems.push(`${family.id}/${variant.id}: @keyframes 动了 ${decl[1]}`)
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'))
})

check('C6 · backdrop-filter 只出现在允许的浮层表面', () => {
  const allowed = [
    "data-dsh-surface='composer'",
    "data-dsh-surface='session-header'",
    "data-dsh-part='dialog'",
    "role='dialog'",
    "role='menu'",
    "role='tooltip'"
  ]
  const tooBroad = ['body', "data-dsh-surface='sidebar'"]
  const problems = []
  for (const { family, variant } of allVariants) {
    for (const rule of cssRules(composedCssOf(family, variant))) {
      if (!rule.body.includes('backdrop-filter')) continue
      for (const one of rule.selector.split(',')) {
        const sel = one.trim()
        if (tooBroad.some((token) => new RegExp(`(^|[\\s>+~])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(sel))) {
          problems.push(`${family.id}/${variant.id}: "${sel}" 上的 backdrop-filter 覆盖面积过大`)
        } else if (!allowed.some((token) => sel.includes(token))) {
          problems.push(`${family.id}/${variant.id}: "${sel}" 不在浮层白名单里`)
        }
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'))
})

check('C10 · 皮肤不得重复声明参数自己的 cssVar（会压住运行时写在 html 上的内联值）', () => {
  // 运行时把每个参数写成 html 上的内联自定义属性。皮肤若在 body 上再声明同名变量，
  // body 的声明对 body 及其后代永远获胜 —— 滑杆看起来有反应、实际毫无作用。
  // 这是「参数被引用」检查（[5]「没有死旋钮」）抓不到的一类静默失效。
  const problems = []
  for (const { family, variant } of allVariants) {
    const css = composedCssOf(family, variant)
    for (const param of variant.params) {
      const declared = new RegExp(`(^|[;{\\s])${param.cssVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`)
      if (declared.test(css)) {
        problems.push(`${family.id}/${variant.id}: 皮肤重复声明了参数 "${param.key}" 的变量 ${param.cssVar}`)
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'))
})

/**
 * 找出 css 中 index 处最近的包裹**函数**名；不在任何函数里时返回 null。
 * 用来判断一个变量究竟被哪种语法消费 —— 只看值本身看不出「48」是颜色还是尺寸。
 * 注意要跳过分组括号：calc((100 - var(--x)) * .5) 的最近包裹函数是 calc，不是那个
 * 紧跟数字的「(」—— 只找最近的标识符会在这种写法上返回空，把合法写法误判成违规。
 */
function enclosingFunction(css, index) {
  let depth = 0
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = css[i]
    if (ch === ')') depth += 1
    else if (ch === '(') {
      if (depth > 0) {
        depth -= 1
        continue
      }
      const m = /([a-zA-Z-]+)\s*$/.exec(css.slice(Math.max(0, i - 24), i))
      if (m !== null) return m[1].toLowerCase()
      // 前面不是标识符 → 这是分组括号，继续往外找真正的函数名。
    } else if (depth === 0 && (ch === ';' || ch === '{' || ch === '}')) return null
  }
  return null
}

// 允许数字参数进入的数学函数；声明了 unit 的参数另可进入接受尺寸的函数。
const MATH_FUNCS = new Set([
  'calc', 'min', 'max', 'clamp', 'round', 'mod', 'rem', 'abs', 'sign', 'hypot',
  'pow', 'sqrt', 'log', 'exp', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
])
const LENGTH_FUNCS = new Set([
  'blur', 'brightness', 'contrast', 'saturate', 'grayscale', 'sepia', 'invert', 'opacity',
  'drop-shadow', 'translate', 'translatex', 'translatey', 'translatez', 'translate3d',
  'scale', 'scalex', 'scaley', 'rotate', 'perspective', 'inset', 'circle', 'ellipse',
])

check('C11 · 引用 number 参数时，兜底值必须与运行时写入的值同型', () => {
  // C10 只发现「变量名撞车」。修它有两条路：删掉同名声明（对，若它本是死变量）或改名
  // （对，若它被下游引用）。选错就得到一类 C10 看不见的新伤：下游 color-mix() 拿到的是
  // 数字而不是颜色，整条声明在计算值阶段失效，滑杆依然毫无作用。
  //
  // 真正的契约是类型。作者写下的 var(--x, <兜底>) 里的兜底值，就是他对「这个变量是什么」
  // 的声明；运行时写进 number 参数的则一定是 <数字> 或 <数字><unit>。两者必须同型：
  //   var(--ls-blur, 12px)  兜底是尺寸，参数 unit=px    → 同型
  //   var(--ls-blur, 12px)  兜底是尺寸，参数无 unit    → 不同型（运行时写「12」）
  //   var(--ls-chrome, 50)  兜底是数字，用在 color-mix  → 兜底同型但位置错，见下
  // 无兜底时无法从字面判断，就要求它出现在数学函数里，或声明了 unit 的尺寸函数里。
  const problems = []
  for (const { family, variant } of allVariants) {
    const css = composedCssOf(family, variant)
    for (const param of variant.params) {
      if (param.type !== 'number') continue
      const escaped = param.cssVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const unit = param.unit ?? ''
      const unitLabel = unit === '' ? '' : `/${unit}`
      const pattern = new RegExp(`var\\(\\s*${escaped}\\s*(?:,\\s*([^)]*?)\\s*)?\\)`, 'g')
      for (const match of css.matchAll(pattern)) {
        const fallback = match[1]
        const fn = enclosingFunction(css, match.index)
        const where = fn === null ? '函数之外' : `${fn}()`
        if (fallback !== undefined) {
          const sameShape = new RegExp(`^-?\\d+(\\.\\d+)?${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(fallback)
          if (!sameShape) {
            problems.push(`${family.id}/${variant.id}: ${param.cssVar}（number${unitLabel}）的兜底值 "${fallback}" 与运行时写入的值不同型`)
            continue
          }
        }
        // 兜底同型时仍要检查位置：兜底 50 落进 color-mix() 一样是无效值。
        if (fn !== null && MATH_FUNCS.has(fn)) continue
        if (unit !== '' && fn !== null && LENGTH_FUNCS.has(fn)) continue
        if (fn === null && (fallback !== undefined || unit !== '')) continue // 尺寸/时间等直接位置，如 animation-duration
        problems.push(`${family.id}/${variant.id}: ${param.cssVar}（number${unitLabel}）被用在 ${where}`)
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'))
})

check('C9 · 皮肤不得注入可见文本（content 只允许空串）', () => {
  // 这条把赛博朋克卷的「不把文字当异域贴纸」变成可执行规则：
  // 伪元素一旦能写文字，就一定会有人往界面里塞招牌。
  const problems = []
  for (const { family, variant } of allVariants) {
    const css = composedCssOf(family, variant)
    for (const decl of css.matchAll(/content\s*:\s*([^;}]+)/gi)) {
      const value = decl[1].trim()
      if (value !== "''" && value !== '""' && value !== 'none' && value !== 'normal') {
        problems.push(`${family.id}/${variant.id}: content: ${value}`)
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'))
})

check('C7 · 不使用哈希类名与 [class*=] 匹配', () => {
  const patterns = [
    { re: /\[class[*^$~|]?=/, why: '[class*=] 依赖 CSS-Module 哈希类名，官方一次重建就废' },
    { re: /\.[A-Za-z0-9]+_[A-Za-z0-9]{3,}_[A-Za-z]/, why: '疑似产品哈希类名' }
  ]
  const problems = []
  for (const { family, variant } of allVariants) {
    for (const rule of cssRules(composedCssOf(family, variant))) {
      for (const { re, why } of patterns) {
        if (re.test(rule.selector)) problems.push(`${family.id}/${variant.id}: "${rule.selector.slice(0, 70)}" — ${why}`)
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'))
})

check('C8 · 零外部资产：不出现 url() 与 @import', () => {
  const problems = []
  for (const { family, variant } of allVariants) {
    const css = composedCssOf(family, variant)
    if (/url\(/i.test(css)) problems.push(`${family.id}/${variant.id}: 出现 url()，皮肤应当零外部资产`)
    if (/@import/i.test(css)) problems.push(`${family.id}/${variant.id}: 出现 @import`)
  }
  assert.deepEqual(problems, [], problems.join('\n'))
})

// ---- C4：对比度 ----
//
// 这一节的难点是**级联**：皮肤样式表由运行时后插进 head，于是「官方值」和「皮肤值」
// 谁生效取决于**特异性**，而不是文档顺序：
//
//   皮肤浅色块   html[data-live-skin] body                      → (0,1,2)
//   官方暗色块   body[data-ds-dark-theme]                       → (0,1,1)
//   皮肤暗色块   html[data-live-skin] body[data-ds-dark-theme]  → (0,2,2)
//
// 中间那行是关键：**皮肤在浅色块里声明、却没在暗色块里重写的 token，在暗色模式下
// 拿到的是浅色值** —— 它压过了官方暗色值。「亮色输入框 + 浅色文字」就是这么来的。
//
// 所以检查器必须做三件旧版没做的事：
//   1. 皮肤没声明时**回落到官方值**（旧版返回 null 直接跳过，于是「皮肤没写」被
//      当成了「没有问题」）；
//   2. 按**特异性**而不是文档顺序决定谁生效；
//   3. **半透明与渐变也要算**（输入框、代码块恰恰普遍是半透明渐变），
//      合成到该模式的页面底色上再比 —— 否则这些表面会被整片跳过，
//      检查又一次形同虚设。

const PROFILE_FOR_THEME = '/Users/lu/.dsh/profiles/web'

/** 从已安装的官方主题插件里读出 light / dark 两张 token 表（含 --dsw-static-* 展开）。 */
function loadOfficialPalette() {
  const out = { light: {}, dark: {}, prim: {}, source: null }
  let src
  try {
    const req = createRequire(join(PROFILE_FOR_THEME, 'package.json'))
    const dir = dirname(req.resolve('@deepseek-ai/dsh-client-ui-theme/package.json'))
    out.source = join(dir, 'lib', 'client.js')
    src = readFileSync(out.source, 'utf8')
  } catch {
    return out
  }
  const pick = (pattern) => {
    let best = {}
    for (const match of src.matchAll(pattern)) {
      const map = {}
      for (const decl of match[1].split(';')) {
        const colon = decl.indexOf(':')
        if (colon > 0) map[decl.slice(0, colon).trim()] = decl.slice(colon + 1).trim()
      }
      if (Object.keys(map).length > Object.keys(best).length) best = map
    }
    return best
  }
  const light = pick(/(?:^|[};])\s*body\s*\{((?:--dsw-[^{}]*?)+)\}/g)
  const dark = pick(/(?:^|[};])\s*body\[data-ds-dark-theme\]\s*\{((?:--dsw-[^{}]*?)+)\}/g)
  const prim = {}
  for (const match of src.matchAll(/(--dsw-static-[\w-]+)\s*:\s*([^;}]+)/g)) prim[match[1]] = match[2].trim()
  const expand = (map) => {
    const one = (value, depth = 0) => {
      if (depth > 8) return value
      const ref = /^var\(\s*(--dsw-[\w-]+)\s*\)$/.exec(value.trim())
      if (ref === null) return value
      const next = prim[ref[1]] ?? map[ref[1]]
      return next === undefined ? value : one(next, depth + 1)
    }
    return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, one(value)]))
  }
  out.prim = prim
  out.light = expand(light)
  out.dark = expand(dark)
  return out
}

const OFFICIAL = loadOfficialPalette()

/** 选择器特异性压成一个可比较的整数：id*1e4 + (类/属性/伪类)*1e2 + 元素。 */
function specificity(selector) {
  const expanded = selector.replace(/:not\(([^)]*)\)/g, ' $1 ')
  const ids = (expanded.match(/#[\w-]+/g) ?? []).length
  const classes = (expanded.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length
  const types = (expanded.match(/(?:^|[\s>+~(,])([a-z][\w-]*)/gi) ?? []).length
  return ids * 10000 + classes * 100 + types
}

/**
 * 把选择器拆成顶层逗号分支。
 * 必须拆：`body:not([data-ds-dark-theme]), body[data-ds-dark-theme]` 这种
 * 「两档都声明」的写法，整串看会同时含有 data-ds-dark-theme 而被判成暗色专属，
 * 于是亮色档整块被跳过 —— 又是「检查的粒度 ≠ 契约的粒度」：
 * 契约是「列表里的每一个选择器」，检查却拿了整串。
 */
function selectorBranches(selector) {
  return splitTopLevel(selector).map((one) => one.trim()).filter((one) => one !== '')
}

/** 单个选择器分支作用于哪个模式：'both' / 'light' / 'dark'。 */
function branchMode(one) {
  if (/data-ds-dark-theme/.test(one.replace(/:not\([^)]*\)/g, ''))) return 'dark'
  if (/:not\([^)]*data-ds-dark-theme[^)]*\)/.test(one)) return 'light'
  return 'both'
}

/** 这条规则在该模式下是否生效（任一分支生效即生效）。 */
function ruleApplies(selector, dark) {
  return selectorBranches(selector).some((one) => {
    const mode = branchMode(one)
    return mode === 'both' || (mode === 'dark') === dark
  })
}

/** 这条规则在该模式下的有效特异性（取生效分支里最高的那个）。 */
function ruleSpecificity(selector, dark) {
  let best = -1
  for (const one of selectorBranches(selector)) {
    const mode = branchMode(one)
    if (mode !== 'both' && (mode === 'dark') !== dark) continue
    best = Math.max(best, specificity(one))
  }
  return best
}

/**
 * 按真实层叠取一条 token 的原始声明文本；皮肤没写就回落到官方值。
 * 官方表先加载，所以同特异性时皮肤胜 —— 官方那条的顺序键记作 -1。
 */
function rawToken(rules, name, dark) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]+)`)
  const official = OFFICIAL[dark ? 'dark' : 'light'][name]
  let best = official
  let bestKey = official === undefined ? -1 : specificity(dark ? 'body[data-ds-dark-theme]' : 'body') * 10000 - 1
  rules.forEach((rule, index) => {
    if (!ruleApplies(rule.selector, dark)) return
    const match = rule.body.match(pattern)
    if (match === null) return
    const key = ruleSpecificity(rule.selector, dark) * 10000 + index
    if (key > bestKey) { bestKey = key; best = match[1].trim() }
  })
  return best
}

/** 按顶层逗号切分（跳过括号内的逗号）。 */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts
}

/** 返回 text 中 openIndex 处那个 '(' 的括号内文本。 */
function balancedInner(text, openIndex) {
  let depth = 0
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') { depth -= 1; if (depth === 0) return text.slice(openIndex + 1, i) }
  }
  return null
}

/** 反复展开 var()，直到不再变化。 */
function substituteVars(text, vars) {
  let out = String(text)
  for (let pass = 0; pass < 6; pass += 1) {
    const next = out.replace(/var\(\s*(--[\w-]+)\s*(?:,([\s\S]*?))?\)/g, (_m, key, fallback) => {
      const value = vars[key]
      if (typeof value === 'string' && value !== '') return value
      return fallback === undefined ? '' : fallback.trim()
    })
    if (next === out) return out
    out = next
  }
  return out
}

/** 求值一个数值表达式（数字、百分比、calc、四则运算），失败返回 null。 */
function evalNumber(expr, vars) {
  let text = substituteVars(expr, vars).trim()
  text = text.replace(/calc\(/gi, '(')
  const percent = /^([\d.]+)%$/.exec(text)
  if (percent !== null) return Number.parseFloat(percent[1]) / 100
  text = text.replace(/\s+/g, '')
  if (text === '' || !/^[-+*/().\d]+$/.test(text)) return null
  try {
    // 上面已把字符集限死在数字与四则运算，这里才敢求值。
    const value = Function(`"use strict";return (${text})`)()
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

/** 解析一个颜色（支持 calc 的 alpha 通道），失败返回 null。 */
function parseColor(text, vars) {
  const trimmed = String(text ?? '').trim()
  const hex = /^#([0-9a-f]{3,8})$/i.exec(trimmed)
  if (hex !== null) {
    const raw = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    if (raw.length !== 6 && raw.length !== 8) return null
    return [
      parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16),
      raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1
    ]
  }
  const fn = /^(rgba?)\(/i.exec(trimmed)
  if (fn === null) return null
  const inner = balancedInner(trimmed, fn[0].length - 1)
  if (inner === null) return null
  let parts = splitTopLevel(inner)
  if (parts.length < 3) parts = inner.split(/[\s/]+/).filter((x) => x !== '') // 空格分隔的现代写法
  if (parts.length < 3 || parts.length > 4) return null
  const channel = (piece) => {
    const value = evalNumber(piece, vars)
    return value === null ? null : Math.max(0, Math.min(255, Math.round(value)))
  }
  const rgb = [channel(parts[0]), channel(parts[1]), channel(parts[2])]
  if (rgb.some((c) => c === null)) return null
  let alpha = 1
  if (parts.length === 4) {
    const value = evalNumber(parts[3], vars)
    if (value === null) return null
    alpha = Math.max(0, Math.min(1, value))
  }
  return [rgb[0], rgb[1], rgb[2], alpha]
}

/** 把半透明色合成到一个不透明底上。 */
function compositeOver(color, base) {
  const alpha = color[3] ?? 1
  if (alpha >= 0.999) return [color[0], color[1], color[2]]
  return [0, 1, 2].map((i) => Math.round(color[i] * alpha + base[i] * (1 - alpha)))
}

/** 从一段渐变参数里取出第一个颜色记号（含括号平衡）。 */
function firstColorToken(piece) {
  const hit = /rgba?\(|#|color-mix\(/i.exec(piece)
  if (hit === null) return null
  if (piece[hit.index] === '#') return (/^#[0-9a-f]{3,8}/i.exec(piece.slice(hit.index)) ?? [null])[0]
  const inner = balancedInner(piece, hit.index + hit[0].length - 1)
  return inner === null ? null : `${hit[0]}${inner})`
}

/**
 * 解算出一个颜色表达式的**候选色**：平面色给 1 个，渐变给每个能解出的色标各 1 个
 * （对比度取其中最差的一个）。半透明保留 alpha，由调用方合成。
 */
function evalColorCandidates(text, vars) {
  const substituted = substituteVars(text, vars).trim()
  const direct = parseColor(substituted, vars)
  if (direct !== null) return [direct]
  const mix = substituted.match(/^color-mix\(in\s+srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)(?:\s+([\d.]+)%)?\s*\)$/i)
  if (mix !== null) {
    const first = parseColor(mix[1], vars)
    const second = parseColor(mix[3], vars)
    if (first === null || second === null) return []
    const weight = Number.parseFloat(mix[2]) / 100
    const rgb = [0, 1, 2].map((i) => Math.round(first[i] * weight + second[i] * (1 - weight)))
    return [[rgb[0], rgb[1], rgb[2], first[3] * weight + second[3] * (1 - weight)]]
  }
  const gradient = substituted.match(/^(?:repeating-)?(?:linear|radial|conic)-gradient\(([\s\S]*)\)$/i)
  if (gradient === null) return []
  const stops = []
  for (const piece of splitTopLevel(gradient[1])) {
    const token = firstColorToken(piece)
    if (token === null) continue
    const parsed = parseColor(token, vars)
    if (parsed !== null) stops.push(parsed)
  }
  return stops
}

/**
 * 一个模式下完整的自定义属性环境，按 (特异性, 顺序) 决出每个名字的胜者：
 *   官方原语 --dsw-static-*  →  官方 token（顺序键 -1，即先加载）
 *   →  皮肤声明的 token 与派生量  →  运行时的参数内联值（最高）
 * 然后把 var() 引用迭代展开（派生的派生也要能解开）。
 *
 * 少了官方那一层，基线里的 `var(--dsw-static-*)` 就解不开，探针会成片报
 * 「解不出颜色」—— 那不是皮肤的问题，是检查器缺了一层。
 */
function buildVars(rules, dark, lsVars) {
  const winners = new Map()
  const offer = (name, value, key) => {
    const previous = winners.get(name)
    if (previous === undefined || key > previous.key) winners.set(name, { key, value })
  }
  for (const [name, value] of Object.entries(OFFICIAL.prim)) offer(name, value, -1)
  const officialKey = specificity(dark ? 'body[data-ds-dark-theme]' : 'body') * 10000 - 1
  for (const [name, value] of Object.entries(OFFICIAL[dark ? 'dark' : 'light'])) offer(name, value, officialKey)
  rules.forEach((rule, index) => {
    if (!ruleApplies(rule.selector, dark)) return
    const key = ruleSpecificity(rule.selector, dark) * 10000 + index
    for (const match of rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) offer(match[1], match[2].trim(), key)
  })
  const env = {}
  for (const [name, entry] of winners) env[name] = entry.value
  // 参数值是运行时写在 html 上的内联自定义属性，压过任何规则。
  for (const [name, value] of Object.entries(lsVars)) env[name] = value
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false
    for (const name of Object.keys(env)) {
      const next = substituteVars(env[name], env)
      if (next !== env[name]) { env[name] = next; changed = true }
    }
    if (!changed) break
  }
  return env
}

/**
 * 皮肤给 body 画的底色。组件都浮在它上面，所以合成基准要用它 ——
 * 不能用「亮色档兜底白」：像柴油朋克那样把 body 画成不透明 #3a3e40 的家族，
 * 用白兜底会凭空把半透明表面算亮，制造出一堆假阳性。
 */
function bodyBackdrop(rules, dark, vars) {
  const pattern = /(?:^|;)\s*background-color\s*:\s*([^;]+)/
  let best = null
  let bestKey = -1
  rules.forEach((rule, index) => {
    if (!ruleApplies(rule.selector, dark)) return
    // 只有「主体正好是 body」的规则才算页面底色。必须排除伪元素与后代：
    // `body::after` 的 background-color 是一层贴图，`body ::selection` 是选中高亮，
    // 它们特异性更高，会被误当成页面底色，然后把一批半透明表面算亮，制造假阳性。
    const bare = rule.selector.replace(/:not\([^)]*\)/g, '')
    const isBodySubject = selectorBranches(bare).some((one) => {
      const last = one.trim().split(/\s+/).pop() ?? ''
      return /^body(\[[^\]]*\])?$/.test(last)
    })
    if (!isBodySubject) return
    const match = rule.body.match(pattern)
    if (match === null) return
    const key = ruleSpecificity(rule.selector, dark) * 10000 + index
    if (key > bestKey) { bestKey = key; best = match[1].trim() }
  })
  if (best === null) return null
  const parsed = evalColorCandidates(best, vars)
  return parsed.length === 0 ? null : parsed[0]
}

/**
 * 取一个 token 在该模式下的最终候选色，已合成到该模式的页面底色上。
 * 半透明表面合成到 --dsw-alias-bg-base 上；bg-base 自己也半透明时，
 * 最外层按黑（暗色档）/ 白（亮色档）兜底。
 */
/**
 * 该模式下**页面最终呈现的不透明底色**：皮肤给 body 画的底色优先，
 * 其次页面 token，最后按模式兜底黑/白。
 * 探针名 `@body` 用它 —— 「正文压在实际页面上」是用户最先看到的那一层，
 * 只看 --dsw-alias-bg-base 会漏掉「token 是暗的、但皮肤没给 body 画暗底」这种情况。
 */
function pageBackdrop(rules, dark, vars) {
  const modeDefault = dark ? [8, 8, 8] : [255, 255, 255]
  const backdrop = bodyBackdrop(rules, dark, vars)
  if (backdrop !== null) return compositeOver(backdrop, modeDefault)
  const baseRaw = rawToken(rules, '--dsw-alias-bg-base', dark)
  const base = baseRaw === undefined ? null : evalColorCandidates(baseRaw, vars)[0] ?? null
  return base === null ? modeDefault : compositeOver(base, modeDefault)
}

function resolveColors(rules, name, vars, dark, depth = 0) {
  const raw = rawToken(rules, name, dark)
  if (raw === undefined) return []
  const candidates = evalColorCandidates(raw, vars)
  if (candidates.length === 0 || depth > 1) return candidates.map((c) => compositeOver(c, dark ? [8, 8, 8] : [255, 255, 255]))
  const flatBase = pageBackdrop(rules, dark, vars)
  return candidates.map((c) => compositeOver(c, flatBase))
}

function contrastRatio(a, b) {
  const lum = ([r, g, bl]) => {
    const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** 官方调色板读不到时 C4 会静默退化成空转 —— 先钉死这个前提。 */
check('C4 前置 · 官方调色板可读', () => {
  assert.ok(OFFICIAL.source !== null, '读不到已安装的 @deepseek-ai/dsh-client-ui-theme')
  assert.ok(Object.keys(OFFICIAL.light).length >= 80, `官方亮色 token 只读到 ${Object.keys(OFFICIAL.light).length} 个`)
  assert.ok(Object.keys(OFFICIAL.dark).length >= 80, `官方暗色 token 只读到 ${Object.keys(OFFICIAL.dark).length} 个`)
})

// 前景/底色的**消费对**。最后一项 required=true 表示必须解算出来 ——
// 解不出来说明解析器与皮肤写法脱节，本身就是失败，而不是跳过。
// 这些不是「随手挑两个变量碰一碰」，每一条都对应界面上真实叠在一起的两层。
const CONTRAST_PROBES = [
  // 填充按钮上的文字（底色是强调色，最容易被写得太浅）
  ['--dsw-alias-label-primary-foreground', '--dsw-alias-button-primary-fill', 4.5, true],
  ['--dsw-alias-label-primary-foreground', '--dsw-alias-button-primary-hover', 4.5, true],
  ['--dsw-alias-label-primary-foreground', '--dsw-alias-button-info-fill', 4.5, false],
  // 页面本身：正文就压在它上面。`@body` 指皮肤给 body 画的真实底色，
  // 与 --dsw-alias-bg-base 不是一回事 —— 组件可能用暗 token，而 body 还画着亮底。
  ['--dsw-alias-label-primary', '@body', 4.5, true],
  ['--dsw-alias-label-secondary', '@body', 3, false],
  // 链接是正文，暗底上直接用品牌色经常不够
  ['--dsw-alias-link', '@body', 4.5, false],
  ['--dsw-alias-link', '--dsw-specific-bubble', 4.5, false],
  ['--dsw-alias-label-primary', '--dsw-alias-bg-base', 4.5, true],
  ['--dsw-alias-label-primary', '--dsw-alias-bg-layer-3', 4.5, true],
  ['--dsw-alias-label-primary', '--dsw-alias-bg-overlay', 4.5, true],
  ['--dsw-alias-label-primary', '--dsw-alias-bg-module-platform', 4.5, true],
  // 输入框 / 列表选项 / 高亮 / 代码 —— 用户实际看到「亮底浅字」的那几处
  ['--dsw-alias-label-primary', '--dsw-specific-input-major', 4.5, true],
  ['--dsw-alias-label-primary', '--dsw-alias-bg-multi-select', 4.5, true],
  ['--dsw-alias-label-primary', '--dsw-specific-selector', 4.5, true],
  ['--dsw-alias-label-primary', '--dsw-specific-bubble-highlight', 4.5, true],
  ['--dsw-alias-label-primary', '--dsw-alias-markdown-code-block', 4.5, true],
  ['--dsw-alias-label-primary', '--dsw-alias-markdown-inline-code', 4.5, true],
  ['--dsw-alias-label-primary', '--dsw-alias-markdown-code-block-banner', 4.5, true],
  ['--dsw-alias-label-primary', '--dsw-alias-markdown-citation', 4.5, true],
  ['--dsw-alias-label-primary', '--dsw-specific-tip', 4.5, true],
  ['--dsw-alias-label-primary', '--dsw-specific-sidebar-fill', 4.5, true],
  ['--dsw-alias-label-primary', '--dsw-specific-sidebar-nav-item-hover', 4.5, false],
  ['--dsw-alias-label-primary', '--dsw-specific-sidebar-nav-item-active', 4.5, false],
  // 次级按钮与浮层
  ['--dsw-alias-label-primary', '--dsw-alias-button-elevated-fill', 4.5, true],
  ['--dsw-alias-label-primary', '--dsw-alias-button-floating-fill', 4.5, false],
  ['--dsw-alias-label-primary', '--dsw-alias-button-ghost-active-fill', 4.5, false],
  ['--dsw-alias-label-primary', '--dsw-alias-button-primary-dimmed', 4.5, false],
  // 指针悬停/按下时文字就压在这两个底色上
  ['--dsw-alias-label-primary', '--dsw-alias-interactive-bg-hover', 4.5, false],
  ['--dsw-alias-label-primary', '--dsw-alias-interactive-bg-active', 4.5, false],
  // 次要文字所在的面（门槛略低，但仍必须看得见）
  ['--dsw-alias-label-secondary', '--dsw-alias-bg-layer-1', 3, false]
]

/**
 * 诊断口：LIVESKIN_DUMP=<family>/<variant> node run.mjs
 * 把该 variant 在两个模式下、每条探针的「原始声明 → 解出的颜色 → 比值」打出来。
 * 对比度报红时靠它判断到底是哪一层的值赢了，而不是靠猜。
 */
if (process.env.LIVESKIN_DUMP !== undefined) {
  const want = process.env.LIVESKIN_DUMP
  for (const { family, variant } of allVariants) {
    if (`${family.id}/${variant.id}` !== want) continue
    const rules = cssRules(composedCssOf(family, variant))
    const lsVars = {}
    for (const param of variant.params) for (const [n, v] of clientModule.paramVars(param, variant.defaults[param.key])) lsVars[n] = v
    for (const dark of [false, true]) {
      const vars = buildVars(rules, dark, lsVars)
      console.log(`\n=== ${want} ${dark ? '暗色' : '亮色'}`)
      for (const [fgName, bgName, min] of CONTRAST_PROBES) {
        const fgs = resolveColors(rules, fgName, vars, dark)
        const bgs = bgName === '@body' ? [pageBackdrop(rules, dark, vars)] : resolveColors(rules, bgName, vars, dark)
        if (fgs.length === 0 || bgs.length === 0) continue
        let worst = Infinity
        for (const fg of fgs) for (const bg of bgs) worst = Math.min(worst, contrastRatio(fg, bg))
        const flag = worst + 1e-9 < min ? '  ✗' : ''
        console.log(`  ${worst.toFixed(2).padStart(6)}:1  ${fgName} on ${bgName}${flag}`)
        if (worst + 1e-9 < min) {
          console.log(`          fg raw=${String(rawToken(rules, fgName, dark)).slice(0, 60)} → ${JSON.stringify(fgs)}`)
          console.log(`          bg raw=${String(rawToken(rules, bgName, dark)).slice(0, 60)} → ${JSON.stringify(bgs)}`)
        }
      }
    }
  }
}

check('C4 · 前景/底色消费对的对比度必须达标（含官方回落与特异性层叠）', () => {
  const problems = []
  let resolved = 0
  let requiredPairs = 0
  for (const { family, variant } of allVariants) {
    const rules = cssRules(composedCssOf(family, variant))
    const lsVars = {}
    for (const param of variant.params) {
      for (const [name, literal] of clientModule.paramVars(param, variant.defaults[param.key])) lsVars[name] = literal
    }
    for (const dark of [false, true]) {
      const vars = buildVars(rules, dark, lsVars)
      for (const [fgName, bgName, min, required] of CONTRAST_PROBES) {
        const fgs = resolveColors(rules, fgName, vars, dark)
        const bgs = bgName === '@body' ? [pageBackdrop(rules, dark, vars)] : resolveColors(rules, bgName, vars, dark)
        if (fgs.length === 0 || bgs.length === 0) {
          if (required) {
            const which = fgs.length === 0 ? fgName : bgName
            problems.push(`${family.id}/${variant.id}${dark ? ' (暗)' : ''}: ${which} 解不出颜色，无法判定对比度`)
          }
          continue
        }
        if (required) requiredPairs += 1
        // 前景可能是渐变；底色也可能是渐变 —— 取最差的那个组合。
        let worst = Infinity
        for (const fg of fgs) for (const bg of bgs) worst = Math.min(worst, contrastRatio(fg, bg))
        resolved += 1
        if (worst + 1e-9 < min) {
          problems.push(`${family.id}/${variant.id}${dark ? ' (暗)' : ''}: ${fgName} on ${bgName} = ${worst.toFixed(2)}:1，低于 ${min}:1`)
        }
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'))
  // 解算数必须覆盖每个 variant 的两个模式 × 全部 required 探针 ——
  // 少一条就说明有 surface 被静默跳过，检查在退化。
  const expected = allVariants.length * 2 * CONTRAST_PROBES.filter((p) => p[3]).length
  assert.ok(requiredPairs >= expected, `必须解算的对比度对只解出 ${requiredPairs} / ${expected}，检查形同虚设`)
  assert.ok(resolved >= expected, `全部解算 ${resolved} 对，少于应解的 ${expected} 对`)
})

// ---------------------------------------------------------------------------
// 6. 客户端半边
// ---------------------------------------------------------------------------

console.log('\n[6] 客户端半边')

check('客户端 bundle 用正确的 id 注册，且与包名一致', () => {
  assert.ok(loaded !== null, 'bundle 没有调用 __ModuleLoader__.load')
  assert.equal(loaded.id, pkg.name)
  assert.equal(typeof loaded.factory, 'function')
})

check('客户端导出 apply / inject，且只依赖 slots', () => {
  assert.equal(typeof clientModule.apply, 'function')
  assert.deepEqual(clientModule.inject, ['slots'])
})

const styleTags = []
const fakeDocument = {
  documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } },
  head: { appendChild(node) { styleTags.push(node) } },
  querySelector: () => null,
  createElement: () => ({ dataset: {}, style: {}, set textContent(value) { this._text = value }, get textContent() { return this._text }, remove() {}, isConnected: false })
}

const registrations = []
let injectedKey = null
const fakeClientCtx = {
  effect(callback) { callback(); return () => {} },
  slots: {
    inject(key, callback) { injectedKey = key; callback(); return () => {} },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    }
  }
}

// 让 apply() 里的启动恢复走测试台的服务，并明确「当前没有任何皮肤被应用」——
// 这一段只观察插槽注册与面板样式表，不让皮肤样式混进来，也不留悬空的失败请求。
await fetch(`${base}/state`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ active: null }) })
{
  const restoreBootFetch = routeFetchThroughServer(base)
  const priorDocument = globalThis.document
  globalThis.document = fakeDocument
  try {
    clientModule.apply(fakeClientCtx)
    await new Promise((done) => setTimeout(done, 250))
  } finally {
    globalThis.document = priorDocument
    restoreBootFetch()
  }
}

check('apply() 往 settings.section 注册一个分区', () => {
  assert.equal(injectedKey, 'settings.section')
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.id, 'live-skin')
  assert.equal(typeof registrations[0].component, 'function')
  assert.equal(registrations[0].options.label(), 'LiveSkin')
})

check('apply() 注入了一份面板样式表', () => {
  assert.equal(styleTags.length, 1)
  assert.ok(String(styleTags[0]._text).includes('[data-live-skin-panel]'))
})

// ---------------------------------------------------------------------------
// 7. 运行时 DOM 契约
// ---------------------------------------------------------------------------

console.log('\n[7] 运行时 DOM 契约')

/** 够用的假 DOM：documentElement 的 inline style + dataset、一个 head、style 元素。 */
function installFakeDom() {
  const created = []
  const document = {
    documentElement: {
      dataset: {},
      style: {
        props: {},
        setProperty(name, value) { this.props[name] = String(value) },
        removeProperty(name) { delete this.props[name] },
        getPropertyValue(name) { return this.props[name] ?? '' }
      }
    },
    head: { appendChild(node) { node.isConnected = true; created.push(node) } },
    createElement() {
      return { dataset: {}, style: {}, isConnected: false, textContent: '', remove() { this.isConnected = false } }
    },
    querySelector() { return null }
  }
  return { document, created }
}

const runtime = clientModule.runtime
const rtFamily = lintCatalog.families.find((entry) => entry.id === 'FrutigerAeroFamily')
const rtVariant = rtFamily.variants.find((entry) => entry.id === 'DarkAero')
const rtKey = 'FrutigerAeroFamily/DarkAero'
const rtValues = { ...rtVariant.defaults }
const rtCss = plugin.composeSkinCss(rtFamily, rtVariant).css
const rtDom = installFakeDom()
const priorDocument = globalThis.document
globalThis.document = rtDom.document

runtime.dispose()
runtime.commit(rtKey, rtVariant.params, rtValues, rtCss)
runtime.paint(rtKey, rtVariant.params, rtValues, rtCss)

const rootStyle = () => rtDom.document.documentElement.style

check('paint() 装上样式表、盖属性、写变量', () => {
  assert.equal(rtDom.document.documentElement.dataset.liveSkin, rtKey)
  assert.equal(rtDom.created.length, 1, '应该恰好插入一个 style 元素')
  assert.equal(rtDom.created[0].textContent, rtCss)
  assert.equal(rootStyle().getPropertyValue('--ls-glass'), '66')
  assert.equal(rootStyle().getPropertyValue('--ls-blur'), '14px', 'number+unit 应拼成 px')
  assert.equal(rootStyle().getPropertyValue('--ls-bubbles'), '1', 'boolean 应变成 1/0')
  assert.equal(rootStyle().getPropertyValue('--ls-bubble-cycle'), '165s')
  assert.equal(rootStyle().getPropertyValue('--ls-accent'), '#35c6f0')
})

check('enum 选项的 CSS 载荷被原样写进变量，并额外派生 -dark', () => {
  const light = rootStyle().getPropertyValue('--ls-wallpaper')
  const dark = rootStyle().getPropertyValue('--ls-wallpaper-dark')
  const option = rtVariant.params
    .find((param) => param.key === 'wallpaper')
    .options.find((entry) => entry.value === 'deep')
  assert.equal(light, option.css, '--ls-wallpaper 应等于选项的 css 载荷')
  assert.equal(dark, option.cssDark, '--ls-wallpaper-dark 应等于选项的 cssDark 载荷')
  assert.ok(light.includes('gradient'), '载荷应该是一串图层')
})

check('preview() 只动变量，不动属性与样式表', () => {
  const before = rtDom.created[0].textContent
  runtime.preview(rtVariant.params, { ...rtValues, bubbles: false, glass: 10 })
  assert.equal(rootStyle().getPropertyValue('--ls-bubbles'), '0')
  assert.equal(rootStyle().getPropertyValue('--ls-glass'), '10')
  assert.equal(rtDom.document.documentElement.dataset.liveSkin, rtKey, '属性不该被 preview 改掉')
  assert.equal(rtDom.created[0].textContent, before, '样式表不该被 preview 重写')
})

check('restore() 回到已提交的那一份', () => {
  runtime.restore()
  assert.equal(rootStyle().getPropertyValue('--ls-bubbles'), '1')
  assert.equal(rootStyle().getPropertyValue('--ls-glass'), '66')
})

check('运行时写出的每个变量名都能对上一个参数（或参数的 -dark 派生）', () => {
  const allowed = new Set()
  for (const param of rtVariant.params) {
    allowed.add(param.cssVar)
    if (param.type === 'enum' && param.options.some((option) => typeof option.cssDark === 'string')) {
      allowed.add(`${param.cssVar}-dark`)
    }
  }
  const written = [...runtime.vars].sort()
  assert.ok(written.length > 0, '运行时一个变量都没写')
  for (const name of written) assert.ok(allowed.has(name), `写了没有参数对应的变量 ${name}`)
  for (const param of rtVariant.params) {
    assert.ok(written.includes(param.cssVar), `参数 ${param.key} 没有产出变量`)
  }
})

check('clear() 拔干净：变量、样式表内容、html 属性', () => {
  runtime.clear()
  assert.equal(rootStyle().getPropertyValue('--ls-glass'), '')
  assert.equal(rtDom.document.documentElement.dataset.liveSkin, undefined)
  assert.equal(rtDom.created[0].textContent, '')
})

check('dispose() 把 style 元素从 head 摘掉', () => {
  runtime.dispose()
  assert.equal(rtDom.created[0].isConnected, false)
  assert.equal(runtime.styleEl, null)
})

globalThis.document = priorDocument

console.log('\n[7b] 两半边夹取规则一致性')

check('宿主 coerceValue 与客户端 coerceParamValue 逐例一致', () => {
  const byKey = new Map(rtVariant.params.map((param) => [param.key, param]))
  const cases = {
    glass: [9999, -5, 55, '42', Number.NaN, null, 'abc', 0, 100],
    blur: [9999, -5, 12, '7', null, undefined],
    accent: ['#fff', '#AABBCC', 'red', 123, null, '  #0f7fc4  '],
    bubbles: [true, false, 'yes', 0, 1, null],
    bubbleAmount: [-1, 101, 55.5, '60'],
    bubbleCycle: [0, 1000, 140, '90'],
    wallpaper: ['deep', 'sky', 'nope', null, 7]
  }
  const mismatches = []
  for (const [key, values] of Object.entries(cases)) {
    const param = byKey.get(key)
    for (const value of values) {
      const host = plugin.coerceValue(param, value)
      const client = clientModule.coerceParamValue(param, value)
      if (!Object.is(host, client)) {
        mismatches.push(`${key}(${JSON.stringify(value)}): 宿主 ${JSON.stringify(host)} ≠ 客户端 ${JSON.stringify(client)}`)
      }
    }
  }
  assert.deepEqual(mismatches, [], mismatches.join('\n'))
})

// ---------------------------------------------------------------------------
// 8. 启动即恢复（跨刷新存活）
// ---------------------------------------------------------------------------

console.log('\n[8] 启动即恢复皮肤')

/** 把客户端的相对请求转发到测试台起的真服务上。 */
function routeFetchThroughServer(serverBase) {
  const API_PREFIX = '/api/live-skin/v1'
  const prior = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : String(input)
    return prior(url.startsWith(API_PREFIX) ? serverBase + url.slice(API_PREFIX.length) : url, init)
  }
  return () => { globalThis.fetch = prior }
}

function freshClientModule() {
  return loaded.factory((spec) => {
    if (spec === 'react') return fakeReact
    throw new Error(`未声明的外部模块：${spec}`)
  })
}

const noopClientCtx = {
  effect(callback) { callback(); return () => {} },
  slots: { inject(key, callback) { callback(); return () => {} }, register() { return () => {} } }
}

console.log('\n[7c] 面板样式纪律')

/**
 * 解析面板自己的样式表。
 * **必须先剥注释**：规则前面写一段多行注释是很自然的事，但如果选择器里带上注释文本，
 * 分组就会错开、两条规则永远配不到一起 —— 检查会**静默失效**却仍然显示绿色。
 * （这不是假设：加了注释之后，下面那条组合态检查真的就不再报警了，靠证伪才发现。）
 */
function panelRules() {
  return [...clientModule.panelCss.replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match, index) => ({
      selector: match[1].replace(/\s+/g, ' ').trim().replace(/^\[data-live-skin-panel\]\s*/, ''),
      body: match[2],
      index
    }))
}

check('面板里任何 hover 改背景的规则，都必须同时钉住文字色', () => {
  // 「浮上去变白」的成因：hover 把背景换成表面染色（浅色模式下接近白），
  // 而填充按钮的文字是白的 —— 白底白字。凡改背景必钉文字色，就不可能发生。
  const problems = []
  for (const rule of panelRules()) {
    if (!rule.selector.includes(':hover')) continue
    if (!/(^|;)\s*background(-color)?\s*:/.test(rule.body)) continue
    if (!/(^|;)\s*color\s*:/.test(rule.body)) problems.push(rule.selector)
  }
  assert.deepEqual(problems, [], `这些 hover 规则改了背景却没钉文字色：\n${problems.join('\n')}`)
})

check('面板里同特异性的状态规则不得「只改文字色、不跟着改底色」', () => {
  // 「浮上去变白」的通用形态：一条状态规则把文字色钉成白（配它自己的深底），
  // 另一条**同特异性但源码在后**的状态规则又把文字色改成深墨色、却没有跟着改底色
  // ——于是深底压深字。家族按钮上就撞到过：`[data-on]` 与 `[data-applied]` 同特异性，
  // 后者的 color 把前者的白字盖掉，而底色仍是后者的强调色填充。
  //
  // 旧版检查只看 `:hover`，所以这条完全不在它的射程内 ——
  // 契约是「任何会改背景的状态组合」，检查却只看了其中一种状态。
  const specific = (selector) => {
    const ids = (selector.match(/#[\w-]+/g) ?? []).length
    const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length
    const types = (selector.match(/(?:^|[\s>+~,])([a-z][\w-]*)/gi) ?? []).length
    return ids * 10000 + classes * 100 + types
  }
  const markers = (selector) => [...selector.matchAll(/\[data-[\w-]+="[^"]*"\]|:(?:hover|focus|active|disabled|focus-visible)/g)].map((m) => m[0])
  const coApplicable = (a, b) => !markers(a).some((x) => markers(b).some((y) => x.split('=')[0] === y.split('=')[0] && x !== y))
  const setsColor = (body) => /(^|;)\s*color\s*:/.test(body)
  const setsBackground = (body) => /(^|;)\s*background(-color)?\s*:/.test(body)

  const rules = panelRules()
  const groups = new Map()
  for (const rule of rules) {
    const base = rule.selector.split(/[[:]/)[0].trim()
    if (base === '') continue
    if (!groups.has(base)) groups.set(base, [])
    groups.get(base).push(rule)
  }
  const problems = []
  for (const [base, list] of groups) {
    for (const earlier of list) {
      if (!setsBackground(earlier.body) || !setsColor(earlier.body)) continue
      if (markers(earlier.selector).length === 0) continue
      for (const later of list) {
        if (later.index <= earlier.index) continue
        if (specific(later.selector) !== specific(earlier.selector)) continue
        if (!setsColor(later.body) || setsBackground(later.body)) continue
        if (markers(later.selector).length === 0) continue
        if (!coApplicable(earlier.selector, later.selector)) continue
        problems.push(`${base}：${later.selector} 覆盖了 ${earlier.selector} 的文字色却没跟着改底色`)
      }
    }
  }
  assert.deepEqual([...new Set(problems)], [], problems.join('\n'))
})

check('填充态按钮必须有属于自己的 hover 填充色', () => {
  // [data-primary="true"] 的特异性 (0,2,0) 低于 .ls-btn:hover:not(:disabled) (0,3,0)，
  // 所以通用 hover 一定会盖掉填充色 —— 必须有一条更高特异性的填充 hover。
  const css = clientModule.panelCss
  const filled = [...css.matchAll(/([^{}]+\[data-primary="true"\])\s*\{/g)].map((m) => m[1].trim())
  assert.ok(filled.length > 0, '没有找到填充态按钮的规则，检查可能已失效')
  for (const selector of filled) {
    const hover = `${selector}:hover`
    assert.ok(css.includes(hover), `缺少 ${hover} 规则，通用 hover 会让填充按钮变成白底白字`)
  }
})

await checkAsync('apply() 会把已保存的皮肤直接画到 DOM 上', async () => {
  // 先切到一个既不是「第一个小类」、也不是前面用过的皮肤：
  // 若它被画上去，就证明读的是持久化状态而不是默认值。
  const target = 'FrutigerAeroFamily/FrutigerAero'
  await fetch(`${base}/state`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ active: target, skin: target })
  })

  const dom = installFakeDom()
  const priorDoc = globalThis.document
  globalThis.document = dom.document
  const restoreFetch = routeFetchThroughServer(base)

  try {
    const fresh = freshClientModule()
    fresh.apply(noopClientCtx)

    const deadline = Date.now() + 3000
    while (fresh.runtime.styleEl === null && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 20))
    }

    assert.equal(dom.document.documentElement.dataset.liveSkin, target,
      'html 上的 data-live-skin 应是持久化的那一套，而不是目录册里的第一个')
    assert.ok(fresh.runtime.styleEl !== null, '3 秒内没有把样式表装上去')
    assert.ok(String(fresh.runtime.styleEl.textContent).includes('html[data-live-skin]'),
      '装上去的应该是这个家族的样式层')
    assert.equal(fresh.runtime.appliedKey, target, 'runtime 应把这一套记成已提交')
  } finally {
    globalThis.document = priorDoc
    restoreFetch()
  }
})

await checkAsync('没有已保存的皮肤时，apply() 不擅自换脸', async () => {
  await fetch(`${base}/state`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ active: null }) })

  const dom = installFakeDom()
  const priorDoc = globalThis.document
  globalThis.document = dom.document
  const restoreFetch = routeFetchThroughServer(base)

  try {
    const fresh = freshClientModule()
    fresh.apply(noopClientCtx)
    await new Promise((done) => setTimeout(done, 400))

    assert.equal(dom.document.documentElement.dataset.liveSkin, undefined,
      '没有任何皮肤被应用时不该在 html 上盖属性')
    assert.equal(fresh.runtime.styleEl, null, '不该插入皮肤样式表')
  } finally {
    globalThis.document = priorDoc
    restoreFetch()
  }
})

// ---------------------------------------------------------------------------
// 9. 设置面板的状态同步
// ---------------------------------------------------------------------------

console.log('\n[9] 设置面板状态同步')

/** 把渲染树里的可见文本拼起来，用于断言。 */
function treeText(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return `${String(node)}\u0001`
  if (Array.isArray(node)) return node.map(treeText).join('')
  return treeText(node.children)
}

/**
 * 极简 React 运行时：够跑这个设置面板，用来验证「挂载 → 卸载 → 重挂载」
 * 时状态是从哪里来的。组件里所有 hook 都是无条件按固定顺序调用的，所以
 * 用游标分配槽位就够，不需要真正的 reconciler。
 */
function makePanelRenderer(react) {
  let current = null
  Object.assign(react, {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      // 实例必须捕获进闭包：setter 可能在渲染循环结束后才被异步回调触发，
      // 那时模块级的 current 已经被清空了。
      const instance = current
      const at = instance.cursor++
      if (!(at in instance.slots)) instance.slots[at] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        const value = typeof next === 'function' ? next(instance.slots[at]) : next
        if (!Object.is(value, instance.slots[at])) {
          instance.slots[at] = value
          instance.dirty = true
        }
      }
      return [instance.slots[at], set]
    },
    useEffect(effect, deps) {
      const at = current.cursor++
      const prev = current.effects[at]
      const same = prev !== undefined && Array.isArray(deps) && Array.isArray(prev.deps) &&
        deps.length === prev.deps.length && deps.every((dep, at2) => Object.is(dep, prev.deps[at2]))
      if (same) return
      if (prev !== undefined && typeof prev.cleanup === 'function') prev.cleanup()
      current.effects[at] = { deps, cleanup: undefined, run: effect }
      current.pending.push(at)
    },
    useRef(initial) {
      const at = current.cursor++
      if (!(at in current.refs)) current.refs[at] = { current: initial }
      return current.refs[at]
    },
    useCallback(fn) { current.cursor += 1; return fn }
  })

  return {
    mount(component) {
      return { component, slots: [], refs: [], effects: [], cursor: 0, pending: [], dirty: false, tree: null }
    },
    async render(instance, props) {
      let tree = null
      // 不能「第一次不脏就退出」：挂载 effect 会发起异步取数，第一帧必然不脏，
      // 那样拿到的只是「正在读取…」。必须连续若干帧安静下来才算稳定。
      let quiet = 0
      for (let tick = 0; tick < 60; tick += 1) {
        current = instance
        instance.cursor = 0
        instance.pending = []
        instance.dirty = false
        tree = instance.component(props)
        for (const at of instance.pending) {
          const entry = instance.effects[at]
          entry.cleanup = entry.run() ?? undefined
        }
        await new Promise((done) => setTimeout(done, 20))
        quiet = instance.dirty ? 0 : quiet + 1
        if (quiet >= 6) break
      }
      current = null
      instance.tree = tree
      return tree
    },
    unmount(instance) {
      current = instance
      for (const entry of instance.effects) {
        if (entry !== undefined && typeof entry.cleanup === 'function') entry.cleanup()
      }
      current = null
    }
  }
}

const panelRenderer = makePanelRenderer(fakeReact)

/** 挂载一个全新面板实例，返回它渲染出的可见文本。 */
async function mountPanelTree(component) {
  const instance = panelRenderer.mount(component)
  return panelRenderer.render(instance, {})
}

async function mountPanelText(component) {
  return treeText(await mountPanelTree(component))
}

/** 收集渲染树里带某个属性的节点（用来断言标记落在哪几张卡片上）。 */
function treeWith(node, key) {
  const out = []
  const walk = (n) => {
    if (n === null || n === undefined || typeof n === 'boolean') return
    if (typeof n === 'string' || typeof n === 'number') return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (n.props !== undefined && n.props[key] !== undefined) out.push(n)
    walk(n.children)
  }
  walk(node)
  return out
}

await checkAsync('重新打开设置面板时，显示的是最新应用过的皮肤', async () => {
  const first = 'FrutigerAeroFamily/DarkAero'
  const second = 'FrutigerAeroFamily/AeroGlass'

  const dom = installFakeDom()
  const priorDoc = globalThis.document
  globalThis.document = dom.document
  const restoreFetch = routeFetchThroughServer(base)

  try {
    // 1) 插件启动时状态是 first —— 这一步会生成「启动快照」
    await fetch(`${base}/state`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ active: first, skin: first }) })
    let panel = null
    const fresh = freshClientModule()
    fresh.apply({
      effect(callback) { callback(); return () => {} },
      slots: {
        inject(key, callback) { callback(); return () => {} },
        register(options, component) { panel = component; return () => {} }
      }
    })
    await new Promise((done) => setTimeout(done, 300))
    assert.equal(typeof panel, 'function', 'apply() 没有注册设置分区组件')

    // 2) 之后又应用了 second（就像用户在面板里换了皮肤）
    await fetch(`${base}/state`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ active: second, skin: second }) })

    // 3) 重新打开面板：必须反映 second，而不是启动时的 first
    const tree = await mountPanelTree(panel)
    const text = treeText(tree)
    // 状态栏用友好名字，而不是 Family/Variant 这样的原始 key —— 用户靠它认皮肤。
    assert.ok(text.includes('当前生效：') && text.includes('Frutiger Aero 家族') && text.includes('AeroGlass'),
      `面板显示的是启动快照而不是最新状态。\n  实际：${text.slice(0, 240)}`)
    // 「使用中」必须落在正好一个家族 chip 和一张卡片上，否则用户切走之后找不回来。
    // 迷你渲染器不展开子组件，所以这里看的是**传给组件的 props**，
    // 正好也是「接线接对了没有」的那一层。
    const chips = treeWith(tree, 'applied')
    const cards = treeWith(tree, 'data-applied').filter((node) => node.props['data-applied'] === 'true')
    assert.equal(chips.filter((node) => node.props.applied === true).length, 1,
      `家族 chip 的「使用中」标记应正好 1 个，实际 ${chips.filter((n) => n.props.applied === true).length} 个`)
    assert.equal(cards.length, 1, `卡片的「使用中」标记应正好 1 个，实际 ${cards.length} 个`)
    assert.ok(text.includes('使用中'), '面板上没有「使用中」字样')
    // 标记要落在 second 上：卡片的子树文本里应当有 AeroGlass 而不是 DarkAero。
    // 注意 DarkAero 作为一张普通卡片本来就在家族列表里，所以不能拿整屏文本判断。
    assert.ok(treeText(cards[0]).includes('AeroGlass'), '「使用中」没有落在最新应用的那张卡片上')

    // 档位徽章：每个小类一个，且不能有「档位未知」
    const badges = treeWith(tree, 'appearance')
    assert.ok(badges.length >= 4, `档位徽章只有 ${badges.length} 个`)
    assert.ok(badges.every((node) => node.props.appearance !== null
      && node.props.appearance.light !== null && node.props.appearance.dark !== null),
    '有皮肤推导不出档位（面板会显示「档位未知」）')
    const appliedVariant = lintCatalog.families
      .find((entry) => entry.id === 'FrutigerAeroFamily')
      .variants.find((item) => item.id === 'AeroGlass')
    const expected = appliedVariant.appearance.followsSystem ? 'both' : appliedVariant.appearance.light
    assert.ok(badges.some((node) => (node.props.appearance.followsSystem ? 'both' : node.props.appearance.light) === expected),
      `没有任何徽章标出 ${expected} 档位`)
  } finally {
    globalThis.document = priorDoc
    restoreFetch()
  }
})

// ---------------------------------------------------------------------------
// 10. 组合接线自检（依赖本机 profile，找不到就跳过）
// ---------------------------------------------------------------------------

console.log('\n[10] 组合接线自检')

const PROFILE = '/Users/lu/.dsh/profiles/web'

if (!existsSync(join(PROFILE, 'package.json'))) {
  console.log(`  – 跳过：找不到 profile ${PROFILE}`)
} else {
  const requireFromProfile = createRequire(join(PROFILE, 'package.json'))
  const yaml = requireFromProfile('js-yaml')
  const profilePkg = JSON.parse(readFileSync(join(PROFILE, 'package.json'), 'utf8'))
  const bundles = profilePkg.dsh.profile.bundles

  check('profile 的 bundle 列表里有 dsh-live-skin', () => {
    assert.ok(bundles.includes('dsh-live-skin'), `实际 bundles：${bundles.join(', ')}`)
    assert.ok(String(profilePkg.dependencies['dsh-live-skin'] ?? '').startsWith('link:'),
      'dsh-live-skin 应以 link: 依赖登记')
  })

  /** 按 loader 的方式逐 bundle 叠加 patch，收集全部 insert 行。 */
  const rows = []
  const unresolved = []
  const unparsable = []
  for (const bundle of bundles) {
    let bundleDir
    try {
      bundleDir = dirname(requireFromProfile.resolve(`${bundle}/package.json`))
    } catch {
      unresolved.push(bundle)
      continue
    }
    const bundlePkg = JSON.parse(readFileSync(join(bundleDir, 'package.json'), 'utf8'))
    const patchRel = bundlePkg.dsh?.bundle?.patch
    if (patchRel === undefined) continue
    // 部署自带的 bundle patch 用 dsh 自己的 YAML 方言（!!js 等），普通 js-yaml
    // 未必吃得下；剥掉自定义 tag 再解析，实在不行只记下来，不当作失败。
    const patchText = readFileSync(resolve(bundleDir, patchRel), 'utf8').replace(/!![a-zA-Z0-9_.-]+[ \t]*/g, '')
    let entries
    try {
      entries = yaml.load(patchText)
    } catch (error) {
      unparsable.push(`${bundle}: ${String(error.message).split('\n')[0]}`)
      continue
    }
    for (const entry of Array.isArray(entries) ? entries : []) {
      for (const row of Array.isArray(entry.insert) ? entry.insert : []) rows.push({ ...row, bundle })
    }
  }

  check('每个 bundle 都能从 profile 解析出 package.json', () => {
    assert.deepEqual(unresolved, [], `解析不到：${unresolved.join(', ')}`)
  })

  check('本插件的 bundle patch 能被解析（其它 bundle 的方言不构成前提）', () => {
    assert.ok(!unparsable.some((line) => line.startsWith('dsh-live-skin')),
      `本插件 patch 解析失败：${unparsable.join(' | ')}`)
  })

  check('叠加完所有 bundle patch 后，dsh-live-skin 行确实在配置树里', () => {
    const mine = rows.filter((row) => row.name === 'dsh-live-skin')
    assert.equal(mine.length, 1, `实际命中 ${String(mine.length)} 行`)
    assert.equal(mine[0].id, 'dsh-live-skin')
  })

  await checkAsync('该行的宿主模块真的能被节点解析出来，且导出插件三件套', async () => {
    const resolved = requireFromProfile.resolve('dsh-live-skin')
    const mod = await import(pathToFileURL(resolved).href)
    assert.equal(typeof mod.apply, 'function')
    assert.deepEqual(mod.inject, ['webServer'])
    assert.equal(mod.name, 'dsh-live-skin')
  })

  check('该行的客户端半边也能被解析出来（exports["./client"]）', () => {
    const entry = requireFromProfile.resolve('dsh-live-skin/client')
    assert.ok(entry.endsWith(join('lib', 'client.js')), `实际：${entry}`)
    assert.ok(existsSync(entry))
  })

  console.log(`  · 配置树里共 ${String(rows.length)} 条 insert 行，来自 ${String(bundles.length)} 个 bundle`)
}

// ---------------------------------------------------------------------------
// 11. 线上代码新鲜度（DSH 没在跑就跳过）
// ---------------------------------------------------------------------------

console.log('\n[11] 线上代码新鲜度')

const LIVE = 'http://127.0.0.1:3080'
let liveUp = false
try {
  const probe = await fetch(`${LIVE}/api/live-skin/v1/health`, { signal: AbortSignal.timeout(2000) })
  liveUp = probe.ok
} catch {
  liveUp = false
}

if (!liveUp) {
  console.log(`  – 跳过：${LIVE} 上没有运行中的 LiveSkin`)
} else {
  await checkAsync('线上客户端 bundle 与磁盘上的 lib/client.js 逐字节一致', async () => {
    // 从 HMR 的 SSE 通道拿启动图，再按图里的 URL 取浏览器真正会加载的那份
    const sse = await fetch(`${LIVE}/plugins/events`, { signal: AbortSignal.timeout(4000) })
    const reader = sse.body.getReader()
    let text = ''
    try {
      while (!text.includes('"id":"dsh-live-skin"')) {
        const { value, done } = await reader.read()
        if (done) break
        text += Buffer.from(value).toString('utf8')
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    const at = text.indexOf('"id":"dsh-live-skin"')
    assert.ok(at >= 0, '启动图里没有 dsh-live-skin —— 客户端半边没被登记')
    const url = text.slice(at, at + 240).match(/"url":"([^"]+)"/)?.[1]
    assert.ok(typeof url === 'string' && url.startsWith('/plugins/'), `启动图里的 URL 不可用：${String(url)}`)

    const served = Buffer.from(await (await fetch(`${LIVE}${url}`)).arrayBuffer()).toString('utf8')
    const onDisk = readFileSync(join(PKG, 'lib', 'client.js'), 'utf8')
    // 宿主会在 combo 脚本尾部追加一行 source map 指针，这是唯一允许的差异。
    assert.ok(served.startsWith(onDisk),
      `线上 bundle 与磁盘不一致（线上 ${String(served.length)} 字节 / 磁盘 ${String(onDisk.length)} 字节）——`
      + ' 改动还没被 HMR 收录，或需要重启 DSH')
    const trailer = served.slice(onDisk.length)
    assert.match(trailer, /^\s*;?\s*\/\/# sourceMappingURL=\/plugins\/\S*\n?$/,
      `线上 bundle 尾部出现了预期外的内容：${JSON.stringify(trailer)}`)
  })

  await checkAsync('线上宿主与磁盘上的宿主源文件是同一版（否则需要重启 DSH）', async () => {
    const health = await (await fetch(`${LIVE}/api/live-skin/v1/health`)).json()
    assert.equal(health.name, 'dsh-live-skin')

    // 判据一：**内容哈希**，不是文件 mtime。
    // 用 mtime 会有两个方向的错：
    //   假阳性 —— `git checkout` / `git reset` / 编辑器保存 / `touch` 会把文件重写成
    //             一模一样的内容却改掉 mtime，于是「明明重启过了却还被判成需要重启」；
    //   假阴性 —— 只比 lib/index.js 的 mtime 会漏掉另一半宿主代码 appearance.js 的改动。
    const hostFiles = readdirSync(join(PKG, 'lib'))
      .filter((name) => name.endsWith('.js') && name !== 'client.js')   // client.js 由上面那条逐字节比对
      .sort()
    const computeHash = (names) => {
      const hash = createHash('sha256')
      for (const name of names) hash.update(name).update('\0').update(readFileSync(join(PKG, 'lib', name)))
      return hash.digest('hex').slice(0, 16)
    }
    assert.ok(Array.isArray(health.hostSources),
      '线上宿主没有上报 hostSources —— 宿主半边是旧的，需要重启 DSH 才能看到本次改动')
    assert.deepEqual([...health.hostSources].sort(), hostFiles,
      `线上宿主登记的宿主源清单是 [${health.hostSources}]，lib/ 下实际是 [${hostFiles}]`
      + ' —— 新增宿主模块后忘了登记进 HOST_SOURCES，或忘了重启')
    assert.equal(health.sourcesHash, computeHash(hostFiles),
      `线上宿主加载的宿主源与磁盘不一致（宿主加载于 ${new Date(health.loadedAt).toISOString()}）`
      + ' —— 需要重启 DSH 才能生效')

    // 判据二（行为）：非法颜色回落到参数默认值，而不是早先的 #888888。
    // 两条互补：前者查「是不是同一份代码」，后者查「关键行为在不在」。
    // 宿主代码是否最新，用一个只有新实现才有的行为判定
    const response = await fetch(`${LIVE}/api/live-skin/v1/state`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ skin: 'FrutigerAeroFamily/DarkAero', values: { accent: 'not-a-color' } })
    })
    const body = await response.json()
    assert.equal(body.state.values['FrutigerAeroFamily/DarkAero'].accent, '#35c6f0',
      '线上宿主仍是旧代码：非法颜色回落到 #888888 而不是参数默认值')
  })
}

// ---------------------------------------------------------------------------

server.close()
console.log(failures === 0 ? '\n全部通过。\n' : `\n${String(failures)} 项失败。\n`)
process.exit(failures === 0 ? 0 : 1)
