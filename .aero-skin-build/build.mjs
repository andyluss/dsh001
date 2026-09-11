/**
 * Frutiger Aero 皮肤族生成器。
 *
 * template/{skin.css,patches.css} 是唯一的手写源；本脚本按下面的参数表
 * 派生出三支配方，写进 out/<id>/。所有替换都是「必须恰好命中一次」的
 * 严格断言，模板一漂移就会报错，不会静默生成半成品。
 *
 * 用法： node build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE = join(HERE, 'template')
const OUT = join(HERE, 'out')

/** 基准平铺块：模板里气泡坐标就是按 620px 写死的。 */
const BASE_TILE = 620
/** 漂移速度，px/s。三支共用，保证「快慢」不是变体差异。 */
const DRIFT = 5

/** 恰好命中一次的字面替换。 */
function sub(text, from, to, tag) {
  const hits = text.split(from).length - 1
  if (hits !== 1) {
    throw new Error(`[${tag}] 期望 "${from.slice(0, 72)}" 命中 1 次，实际 ${hits} 次`)
  }
  return text.split(from).join(to)
}

function fmt(n) {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : String(r)
}

/**
 * 气泡层不透明度的换算系数。
 *
 * 滑杆写进 body 的是 0..1 的原始比例，但浏览器端会把持久化状态推回它自己的
 * 默认值（bubbleOpacity = 50）。与其跟它抢，不如把映射校准成「滑杆停在 50 时
 * 正好是这一支想要的观感」：gain = 目标不透明度 / 0.5。
 */
function bubbleGain(p) {
  return (Number(p.bubbleAt50) / 0.5).toFixed(2)
}

const VARIANTS = [
  {
    id: 'frutiger-aero-calm',
    suffix: '-calm',
    name: 'Frutiger Aero · 清淡',
    nameEn: 'Frutiger Aero · Calm',
    tagline: '通透淡雅 · 稀疏大气泡 · 长文与代码友好',
    description:
      'Frutiger Aero 的淡口版本：壁纸更亮更粉彩，玻璃面板更透，气泡又少又大、飘得极慢，磨砂最轻。长时间读长文或盯代码时，天空草地还在，但不抢注意力。同样接入「背景遮蔽」与「气泡不透明度」两支滑杆。',
    tags: ['frutiger-aero', 'calm', 'pastel', 'translucent', 'minimal'],
    accent: '#3fa9d8',
    order: 11,
    tile: 980,
    bubbleAt50: '.40',
    darkScale: '.65',
    blur: '10px',
    bandLight: '.34',
    bandDark: '.08',
    baseLight: ['.16', '.38'],
    baseDark: ['.34', '.40'],
    sideLight: ['.36', '.28', '.18'],
    sideDark: ['.50', '.38', '.20'],
    colors: {
      skyTop: '#9adcf4', skyMid: '#c4ebfa', horizon: '#eefbff', grassLight: '#e4f6d2', grassDeep: '#c2e99b',
      gloss: '.86', sun: '.65',
      hill: 'radial-gradient(140% 62% at 50% 124%, #93d05f 0%, #cbea9f 38%, rgba(203, 234, 159, 0) 70%)',
      dSkyTop: '#041c29', dSkyMid: '#08374e', dHorizon: '#0b4a63', dGrass: '#062f42', dDeep: '#031a27'
    }
  },
  {
    id: 'frutiger-aero',
    suffix: '',
    name: 'Frutiger Aero · 标准',
    nameEn: 'Frutiger Aero',
    tagline: '天蓝草地 · 玻璃拟态 · 上浮气泡',
    description:
      '2004–2013 年 Frutiger Aero 时代美学：天空到草地的渐变壁纸、水面光泽、半透明玻璃面板与不断上浮的气泡。浅色是「白天水族箱」，深色是「深海夜光」，跟随系统亮暗自动切换。接入了皮肤中心的两支滑杆：背景遮蔽控制面板遮住壁纸的程度，气泡不透明度控制上浮气泡的强弱（拉到 0 即关闭）。',
    tags: ['frutiger-aero', 'glass', 'aqua', 'translucent', 'y2k'],
    accent: '#0f7fc4',
    order: 10,
    tile: 620,
    bubbleAt50: '.58',
    darkScale: '.70',
    blur: '12px',
    bandLight: '.50',
    bandDark: '.12',
    baseLight: ['.30', '.52'],
    baseDark: ['.46', '.52'],
    sideLight: ['.50', '.40', '.24'],
    sideDark: ['.62', '.50', '.24'],
    colors: {
      skyTop: '#79cdec', skyMid: '#a5e0f7', horizon: '#ddf5ff', grassLight: '#cceeb2', grassDeep: '#9adf68',
      gloss: '.96', sun: '.85',
      hill: 'radial-gradient(140% 62% at 50% 124%, #5fb832 0%, #a6e259 38%, rgba(166, 226, 89, 0) 70%)',
      dSkyTop: '#03202f', dSkyMid: '#063c56', dHorizon: '#0a5570', dGrass: '#07364c', dDeep: '#041d2c'
    }
  },
  {
    id: 'frutiger-aero-rich',
    suffix: '-rich',
    name: 'Frutiger Aero · 浓郁',
    nameEn: 'Frutiger Aero · Rich',
    tagline: '饱和蓝天 · 密集气泡 · 最重的玻璃与磨砂',
    description:
      'Frutiger Aero 的浓口版本：天空更饱和、草地更绿，气泡又密又小，玻璃高光与磨砂都加码，最接近 2007 年那张桌面壁纸。信息密度高的界面会显得更「满」，适合展示与短会话。同样接入「背景遮蔽」与「气泡不透明度」两支滑杆。',
    tags: ['frutiger-aero', 'rich', 'vivid', 'glass', 'y2k'],
    accent: '#1a94dd',
    order: 12,
    tile: 470,
    bubbleAt50: '.72',
    darkScale: '.70',
    blur: '16px',
    bandLight: '.64',
    bandDark: '.18',
    baseLight: ['.40', '.58'],
    baseDark: ['.54', '.56'],
    sideLight: ['.62', '.54', '.30'],
    sideDark: ['.72', '.62', '.28'],
    colors: {
      skyTop: '#45b4e4', skyMid: '#7fd0f2', horizon: '#cdeeff', grassLight: '#b6e88a', grassDeep: '#7ccb3a',
      gloss: '.99', sun: '.95',
      hill: 'radial-gradient(140% 62% at 50% 124%, #3f9c22 0%, #8fd94a 40%, rgba(143, 217, 74, 0) 72%)',
      dSkyTop: '#021824', dSkyMid: '#04435f', dHorizon: '#0a6280', dGrass: '#083c54', dDeep: '#02141f'
    }
  }
]

/** 生成一支配方的 skin.css。 */
function buildSkinCss(p) {
  let css = readFileSync(join(TEMPLATE, 'skin.css'), 'utf8')
  const c = p.colors

  // 面板玻璃：alpha = 基线 + 遮蔽滑杆 × 斜率（滑杆 .5 处还原模板外观）
  css = sub(css,
    'calc(.30 + var(--dsw-skin-scrim, .5) * .52)',
    `calc(${p.baseLight[0]} + var(--dsw-skin-scrim, .5) * ${p.baseLight[1]})`,
    `${p.id} light bg-base`)
  css = sub(css,
    'calc(.46 + var(--dsw-skin-scrim, .5) * .52)',
    `calc(${p.baseDark[0]} + var(--dsw-skin-scrim, .5) * ${p.baseDark[1]})`,
    `${p.id} dark bg-base`)
  css = sub(css,
    'linear-gradient(180deg, rgba(255, 255, 255, calc(.50 + var(--dsw-skin-scrim, .5) * .24)), rgba(212, 240, 253, calc(.40 + var(--dsw-skin-scrim, .5) * .24)))',
    `linear-gradient(180deg, rgba(255, 255, 255, calc(${p.sideLight[0]} + var(--dsw-skin-scrim, .5) * ${p.sideLight[2]})), rgba(212, 240, 253, calc(${p.sideLight[1]} + var(--dsw-skin-scrim, .5) * ${p.sideLight[2]})))`,
    `${p.id} light sidebar`)
  css = sub(css,
    'linear-gradient(180deg, rgba(9, 40, 58, calc(.62 + var(--dsw-skin-scrim, .5) * .24)), rgba(5, 28, 42, calc(.50 + var(--dsw-skin-scrim, .5) * .24)))',
    `linear-gradient(180deg, rgba(9, 40, 58, calc(${p.sideDark[0]} + var(--dsw-skin-scrim, .5) * ${p.sideDark[2]})), rgba(5, 28, 42, calc(${p.sideDark[1]} + var(--dsw-skin-scrim, .5) * ${p.sideDark[2]})))`,
    `${p.id} dark sidebar`)

  // 壁纸：天空 → 草地 5 个色标、草地圆丘、左上光泽、右上阳光
  const stops = [
    [c.skyTop, '0%'], [c.skyMid, '28%'], [c.horizon, '50%'], [c.grassLight, '76%'], [c.grassDeep, '100%']
  ].map(([col, at]) => `${col} ${at}`).join(', ')
  css = sub(css,
    'linear-gradient(180deg, #79cdec 0%, #a5e0f7 28%, #ddf5ff 50%, #cceeb2 76%, #9adf68 100%)',
    `linear-gradient(180deg, ${stops})`,
    `${p.id} light wallpaper`)
  css = sub(css,
    'radial-gradient(140% 62% at 50% 124%, #5fb832 0%, #a6e259 38%, rgba(166, 226, 89, 0) 70%)',
    c.hill,
    `${p.id} light hill`)
  css = sub(css, 'rgba(255, 255, 255, .96) 0%, rgba(255, 255, 255, 0) 62%',
    `rgba(255, 255, 255, ${c.gloss}) 0%, rgba(255, 255, 255, 0) 62%`, `${p.id} light gloss`)
  css = sub(css, 'rgba(255, 248, 214, .85)', `rgba(255, 248, 214, ${c.sun})`, `${p.id} sun`)

  const dstops = [
    [c.dSkyTop, '0%'], [c.dSkyMid, '30%'], [c.dHorizon, '52%'], [c.dGrass, '76%'], [c.dDeep, '100%']
  ].map(([col, at]) => `${col} ${at}`).join(', ')
  css = sub(css,
    'linear-gradient(180deg, #03202f 0%, #063c56 30%, #0a5570 52%, #07364c 76%, #041d2c 100%)',
    `linear-gradient(180deg, ${dstops})`,
    `${p.id} dark wallpaper`)

  return css
}

/** 生成一支配方的 patches.css。 */
function buildPatchesCss(p) {
  let css = readFileSync(join(TEMPLATE, 'patches.css'), 'utf8')
  const name = `frutiger-aero${p.suffix}-rise`
  const duration = Math.round(p.tile / DRIFT)

  css = sub(css, 'background-size: 620px 620px;', `background-size: ${p.tile}px ${p.tile}px;`, `${p.id} tile`)
  css = sub(css, 'height: calc(100vh + 640px);', `height: calc(100vh + ${p.tile + 20}px);`, `${p.id} height`)
  css = sub(css, 'animation: frutiger-aero-rise 120s linear infinite;',
    `animation: ${name} ${duration}s linear infinite;`, `${p.id} animation`)
  css = sub(css, '@keyframes frutiger-aero-rise {', `@keyframes ${name} {`, `${p.id} keyframes`)
  css = sub(css, 'transform: translate3d(0, -620px, 0);', `transform: translate3d(0, -${p.tile}px, 0);`, `${p.id} shift`)
  css = sub(css, 'opacity: var(--dsh-skin-bubble-alpha, .58);',
    `opacity: calc(var(--dsh-skin-bubble-alpha, .5) * ${bubbleGain(p)});`, `${p.id} light bubble opacity`)
  css = sub(css, 'opacity: calc(var(--dsh-skin-bubble-alpha, .58) * .7);',
    `opacity: calc(var(--dsh-skin-bubble-alpha, .5) * ${bubbleGain(p)} * ${p.darkScale});`, `${p.id} dark bubble opacity`)
  css = sub(css, 'linear-gradient(180deg, rgba(255, 255, 255, .5) 0%, rgba(255, 255, 255, 0) 100%)',
    `linear-gradient(180deg, rgba(255, 255, 255, ${p.bandLight}) 0%, rgba(255, 255, 255, 0) 100%)`, `${p.id} band light`)
  css = sub(css, 'linear-gradient(180deg, rgba(150, 235, 255, .12) 0%, rgba(150, 235, 255, 0) 100%)',
    `linear-gradient(180deg, rgba(150, 235, 255, ${p.bandDark}) 0%, rgba(150, 235, 255, 0) 100%)`, `${p.id} band dark`)
  css = sub(css, 'backdrop-filter: blur(12px) saturate(1.25);',
    `backdrop-filter: blur(${p.blur}) saturate(1.25);`, `${p.id} blur`)

  // 气泡贴图随平铺块整体缩放：位置按 tile 线性缩放，半径按平方根缩放
  // （否则「清淡」会变成几颗巨大的泡，「浓郁」会碎成一堆小点）。
  const pScale = p.tile / BASE_TILE
  const rScale = Math.sqrt(pScale)
  let scaled = 0
  css = css.replace(/circle ([\d.]+)px at ([\d.]+)px ([\d.]+)px/g, (_m, r, x, y) => {
    scaled += 1
    return `circle ${fmt(Number(r) * rScale)}px at ${fmt(Number(x) * pScale)}px ${fmt(Number(y) * pScale)}px`
  })
  if (scaled !== 12) throw new Error(`[${p.id}] 气泡坐标应缩放 12 处（浅色 6 + 深色 6），实际 ${scaled} 处`)

  return css
}

function buildManifest(p) {
  return {
    $schema: 'https://schemas.linxin666.org/dsh-skin/v2.json',
    skinManifestVersion: 2,
    id: p.id,
    name: p.name,
    nameEn: p.nameEn,
    version: '1.0.0',
    author: 'dsh001 · 由动态 Cordis 插件固化',
    tagline: p.tagline,
    description: p.description,
    tags: p.tags,
    accent: p.accent,
    order: p.order,
    license: 'MIT',
    contributes: { stylesheet: 'skin.css', patches: 'patches.css' }
  }
}

rmSync(OUT, { recursive: true, force: true })
for (const p of VARIANTS) {
  const dir = join(OUT, p.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'skin.css'), buildSkinCss(p))
  writeFileSync(join(dir, 'patches.css'), buildPatchesCss(p))
  writeFileSync(join(dir, 'skin.json'), JSON.stringify(buildManifest(p), null, 2) + '\n')
  console.log(`built ${p.id.padEnd(20)} tile=${String(p.tile).padStart(4)}px  `
    + `bubble≈${String(Math.round((1440 / p.tile) * (900 / p.tile) * 3)).padStart(2)}  `
    + `cycle=${Math.round(p.tile / DRIFT)}s  blur=${p.blur}`)
}
console.log('\nout/: ' + readdirSync(OUT).join(', '))
