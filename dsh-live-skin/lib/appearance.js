/**
 * 判定一套皮肤在每个系统配色模式下**实际画出来的页面是亮还是暗**。
 *
 * 为什么不手写声明：手写的「支持亮色/暗色」会跟皮肤实际做的事漂移。这里直接从
 * 皮肤自己声明的 CSS 里推：找在该模式下真正生效的 `body` 底色（考虑 `:not(...)` 守卫、
 * `[data-ds-dark-theme]` 守卫、以及选择器特异性），算它的相对亮度。
 *
 * 三个已知的坑（都是实测踩出来的）：
 *  1. 选择器可能是**逗号列表**，例如 `body:not([data-ds-dark-theme]), body[data-ds-dark-theme]`
 *     ——「两档都声明」。整串看会同时含 data-ds-dark-theme 而被误判成暗色专属，
 *     必须按分支判定。
 *  2. 只按文档顺序取最后一条是不够的：皮肤样式表由运行时**后插**进 head，
 *     谁生效由特异性决定。
 *  3. 不能只看 `--dsw-alias-bg-base`：皮肤可能给组件用暗 token，而 `body` 底色还是亮的
 *     （这正是「暗色档整页看不见」的那个故障）。
 */

/** 顶层逗号切分（跳过括号内的逗号）。 */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** 把 CSS 拆成 { selector, body } 序列；注释先剥掉。 */
export function cssRules(css) {
  const clean = String(css).replace(/\/\*[\s\S]*?\*\//g, '')
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].replace(/\s+/g, ' ').trim(),
    body: match[2]
  }))
}

/** 选择器特异性压成可比较的整数。 */
function specificity(selector) {
  const expanded = selector.replace(/:not\(([^)]*)\)/g, ' $1 ')
  const ids = (expanded.match(/#[\w-]+/g) ?? []).length
  const classes = (expanded.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length
  const types = (expanded.match(/(?:^|[\s>+~(,])([a-z][\w-]*)/gi) ?? []).length
  return ids * 10000 + classes * 100 + types
}

/** 单个选择器分支作用于哪个模式：'both' / 'light' / 'dark'。 */
function branchMode(one) {
  if (/data-ds-dark-theme/.test(one.replace(/:not\([^)]*\)/g, ''))) return 'dark'
  if (/:not\([^)]*data-ds-dark-theme[^)]*\)/.test(one)) return 'light'
  return 'both'
}

/** 这条规则在该模式下是否生效。 */
function ruleApplies(selector, dark) {
  return splitTopLevel(selector).some((one) => {
    const branch = one.trim()
    if (branch === '') return false
    const mode = branchMode(branch)
    return mode === 'both' || (mode === 'dark') === dark
  })
}

/** 这条规则在该模式下的有效特异性（生效分支里最高的那个）。 */
function ruleSpecificity(selector, dark) {
  let best = -1
  for (const raw of splitTopLevel(selector)) {
    const branch = raw.trim()
    if (branch === '') continue
    const mode = branchMode(branch)
    if (mode !== 'both' && (mode === 'dark') !== dark) continue
    best = Math.max(best, specificity(branch))
  }
  return best
}

/** 选择器的主体是不是正好 `body`（排除 body::after / body ::selection 这类）。 */
function isBodySubject(selector) {
  const bare = selector.replace(/:not\([^)]*\)/g, '')
  return splitTopLevel(bare).some((one) => {
    const last = one.trim().split(/\s+/).pop() ?? ''
    return /^body(\[[^\]]*\])?$/.test(last)
  })
}

/** 按顶层分号切出声明。 */
function declarations(body) {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ';' && depth === 0) {
      out.push(body.slice(start, i))
      start = i + 1
    }
  }
  out.push(body.slice(start))
  return out
}

/** 从一段值里取第一个颜色字面量，返回 [r,g,b]（忽略 alpha —— 这里只判明暗）。 */
function firstColor(value) {
  const hex = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(value)
  if (hex !== null) {
    const raw = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return [0, 2, 4].map((i) => Number.parseInt(raw.slice(i, i + 2), 16))
  }
  const fn = /\brgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value)
  if (fn !== null) return [1, 2, 3].map((i) => Number(fn[i]))
  return null
}

function luminance([r, g, b]) {
  const channel = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** 取某个属性在该模式下生效的最终声明文本。 */
function winning(rules, dark, match, subject) {
  let best = null
  let bestKey = -1
  rules.forEach((rule, index) => {
    if (subject !== undefined && subject(rule.selector) !== true) return
    if (!ruleApplies(rule.selector, dark)) return
    const key = ruleSpecificity(rule.selector, dark) * 10000 + index
    if (key <= bestKey) return
    for (const decl of declarations(rule.body)) {
      const hit = match(decl)
      if (hit !== null) {
        bestKey = key
        best = hit
      }
    }
  })
  return best
}

const COLOR_PROP = /(?:^|[\s;])background-color\s*:\s*([^;]+)/i
const TOKEN = /(?:^|[\s;])--dsw-alias-bg-base\s*:\s*([^;]+)/i

/**
 * @param {string} css 组合后的皮肤 CSS（家族层 + 小类层）
 * @returns {{light: 'light'|'dark'|null, dark: 'light'|'dark'|null, followsSystem: boolean}}
 */
export function analyzeAppearance(css) {
  const rules = cssRules(css)
  const polarity = (dark) => {
    // 皮肤给 body 画的底色优先 —— 它就是页面本身。
    const painted = winning(rules, dark, (decl) => {
      const hit = COLOR_PROP.exec(decl.startsWith('background-color') ? `;${decl}` : decl)
      return hit === null ? null : hit[1].trim()
    }, isBodySubject)
    const token = winning(rules, dark, (decl) => {
      const hit = TOKEN.exec(decl.startsWith('--dsw-alias-bg-base') ? `;${decl}` : decl)
      return hit === null ? null : hit[1].trim()
    })
    const color = firstColor(painted ?? token ?? '')
    if (color === null) return null
    // 0.35 落在米白（≈0.83）与暗档深色（≈0.01–0.05）之间，中间没有歧义样本。
    return luminance(color) >= 0.35 ? 'light' : 'dark'
  }
  const light = polarity(false)
  const dark = polarity(true)
  return { light, dark, followsSystem: light !== null && dark !== null && light !== dark }
}
