#!/usr/bin/env python3
"""从一份紧凑的色板规格生成一个 LiveSkin 家族的 `family.json` + `base.css`。

为什么这样做
------------
一个家族的两档各要 95 个 `--dsw-*` token，形状（哪个是渐变、哪个带
`calc(var(--ls-glass-alpha) + …)`、哪个是 rgba）比颜色更容易出错 ——
漏一个 token 就是「暗色档某个表面沿用亮色值」那类故障。

所以本脚本以**一个已经通过全部验收的家族作为结构模板**（默认 `AtompunkFamily`），
只做**颜色替换**：token 集、顺序、函数形状全部原样继承。
规格里没有覆盖到的颜色字面量会**直接报错**，不静默放过。

用法
----
    python3 scripts/gen-family.py --list
    python3 scripts/gen-family.py TerranFamily          # 写盘
    python3 scripts/gen-family.py TerranFamily --dry    # 只打印摘要

生成之后**必须**跑验收台：`node test/run.mjs`。C4 会把对比度、两档约定、
`@body` 页面级探针逐条查一遍 —— 颜色是推断出来的，只有那些断言能证明它没坏。
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
SKINS = HERE.parent / 'skins'
TEMPLATE = 'AtompunkFamily'

# ---------------------------------------------------------------------------
# 结构模板里的颜色字面量，按角色归类。
# 这些列表来自 AtompunkFamily（两档各 95 token，验收台全绿）。改动模板家族时
# 必须同步这些清单 —— 覆盖不全脚本会报错，不会静默漏掉。
# ---------------------------------------------------------------------------
# 模板块里的「表面色」不再手抄：按亮度与色相自动分类
#   · 中性表面：G 不是最大分量（暖灰或纯灰）
#   · 带色底纹：G 同时大于 R 与 B（模板里的薄荷绿底纹）
# 其余字面量按下面的角色表显式对应。分类由脚本自己做，模板改了也不会漏抄。
T_LIGHT_ROLE = {             # 其余角色，显式逐一对应
    (43, 38, 34): 'ink', (58, 51, 44): 'ink2', (92, 83, 72): 'ink3',
    (123, 114, 102): 'ink4', (139, 129, 117): 'ink5', (196, 187, 169): 'inkDim',
    (11, 17, 22): 'mixInk', (10, 10, 10): 'mixBase', (38, 33, 29): 'deepFill',
    (120, 110, 96): 'borderWarm', (96, 88, 76): 'borderWarm2',
    (24, 20, 17): 'mask', (30, 26, 22): 'mask2', (60, 50, 40): 'shadow',
    (31, 74, 99): 'bluish',
    (207, 58, 31): 'error', (63, 138, 99): 'ok', (98, 168, 132): 'ok2',
    (168, 106, 18): 'warnLabel', (232, 185, 35): 'warn', (240, 205, 92): 'warn2',
    (228, 87, 46): 'accent', (168, 205, 187): 'tint', (120, 178, 158): 'tintDeep',
}
T_DARK_ROLE = {
    (238, 241, 243): 'ink', (192, 198, 202): 'ink2', (156, 163, 168): 'ink3',
    (135, 142, 147): 'ink4', (85, 91, 96): 'ink5', (182, 189, 194): 'inkDim',
    (168, 205, 216): 'bluish', (216, 221, 226): 'borderWarm',
    (8, 9, 10): 'mask', (4, 5, 6): 'mask2', (24, 26, 28): 'mask3', (24, 20, 17): 'mask',
    (200, 240, 255): 'skeleton', (0, 0, 0): 'shadow',
    (10, 10, 10): 'mixBase', (255, 255, 255): 'white',
    (228, 87, 46): 'accent', (168, 205, 187): 'tint', (120, 178, 158): 'tintDeep',
    (255, 138, 106): 'error', (120, 201, 155): 'ok',
    (232, 185, 35): 'warn', (240, 205, 92): 'warn2',
}

# ---------------------------------------------------------------------------
# 色板规格。每个家族给出两档的少量锚点，梯子由锚点插值生成。
# ---------------------------------------------------------------------------
def ladder(recessed, raised, n):
    """在 sRGB 上按秩次插值出一条 n 级表面梯子（暗 → 亮）。"""
    return [
        tuple(round(recessed[i] + (raised[i] - recessed[i]) * k / (n - 1)) for i in range(3))
        for k in range(n)
    ]


SPECS: dict[str, dict] = {
    'TerranFamily': dict(
        name='人族', nameEn='Terran',
        description='星际争霸 · 人族：被流放者用铆钉和胶带把旧联邦的破烂拼成能用的东西。'
                    '冲压钢板、橄榄绿、琥珀色仪表背光；光是均匀的顶灯，不为戏剧性服务。',
        accent='#b8641f',
        tags=['starcraft', 'terran', 'industrial', 'military'],
        param_special=dict(key='scanner', label='仪表扫描线', group='材质',
                           description='CRT 仪表盘的横向扫描线强度。0 = 干净的现代平板',
                           default=55),
        light=dict(recessed=(200, 203, 199), raised=(255, 255, 255), page=(223, 224, 220),
                   ink=(35, 38, 42), ink2=(58, 62, 66), ink3=(92, 97, 102),
                   ink4=(123, 128, 133), ink5=(139, 144, 149), inkDim=(196, 200, 204),
                   mixInk=(17, 21, 26), mixBase=(10, 10, 10), deepFill=(17, 21, 26),
                   borderWarm=(120, 126, 132), borderWarm2=(96, 102, 108),
                   mask=(24, 26, 30), mask2=(30, 33, 37), shadow=(60, 64, 70),
                   bluish=(31, 74, 99),
                   error=(178, 58, 38), ok=(79, 122, 70), ok2=(120, 168, 120),
                   warnLabel=(150, 110, 20), warn=(200, 150, 20), warn2=(232, 200, 92),
                   accent=(184, 100, 31), tint=(154, 168, 124), tintDeep=(110, 132, 90),
                   tint_recessed=(206, 214, 200), tint_raised=(232, 240, 226)),
        dark=dict(recessed=(36, 40, 44), raised=(76, 80, 84), page=(28, 31, 34),
                  ink=(226, 230, 232), ink2=(192, 198, 202), ink3=(156, 163, 168),
                  ink4=(135, 142, 147), ink5=(85, 91, 96), inkDim=(182, 189, 194),
                  bluish=(168, 205, 216), borderWarm=(216, 221, 226),
                  mask=(8, 9, 10), mask2=(4, 5, 6), mask3=(24, 26, 28),
                  skeleton=(200, 240, 255), shadow=(0, 0, 0), mixBase=(10, 10, 10),
                  white=(255, 255, 255),
                  accent=(224, 138, 52), tint=(168, 178, 140), tintDeep=(120, 140, 110),
                  error=(255, 138, 106), ok=(120, 180, 120),
                  warn=(232, 185, 35), warn2=(240, 205, 92)),
        # 由参数派生的中间量（两档共用）
        locals=[
            ('--ls-glass-alpha', 'calc(.90 - var(--ls-glass, 52) * .0060)'),
            ('--ls-grain-a', 'calc(var(--ls-grain, 50) * .0120)'),
            ('--ls-vig-a', 'calc(var(--ls-vignette, 45) * .0040)'),
            ('--ls-scanner-a', 'calc(var(--ls-scanner, 55) * .0040)'),
            ('--ls-int', 'calc(var(--ls-intensity, 60) * .01)'),
            ('--ls-scanner-eff', 'calc(var(--ls-scanner-a) * var(--ls-int))'),
            ('--ls-grain-eff', 'calc(var(--ls-grain-a) * var(--ls-int))'),
            ('--ls-steel', '#5c6266'),
            ('--ls-olive', '#6b7350'),
            ('--ls-amber', '#e08a34'),
        ],
        materials='''
/* —— 材质：冲压钢板 + 铆接板缝 + 仪表扫描线 ——
   顶灯是均匀的，所以没有明暗面，只有板缝的 1px 内嵌亮边。
   暗角单独一层叠在同一个元素上，省掉一个伪元素。 */
html[data-live-skin] body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image:
    repeating-linear-gradient(180deg,
      rgba(255, 255, 255, .5) 0 1px, rgba(0, 0, 0, .06) 1px 2px, transparent 2px 148px),
    repeating-linear-gradient(90deg, rgba(0, 0, 0, .05) 0 1px, transparent 1px 220px),
    radial-gradient(130% 100% at 50% 50%, transparent 52%, rgba(0, 0, 0, var(--ls-vig-a)) 100%);
  background-repeat: repeat, repeat, no-repeat;
  opacity: calc(.30 + var(--ls-grain-eff) * .70);
}
html[data-live-skin] body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image: repeating-linear-gradient(180deg,
    rgba(0, 0, 0, calc(var(--ls-scanner-eff) * .55)) 0 1px, transparent 1px 3px);
  animation-name: var(--ls-fx-name, terran-scanner-drift);
  animation-duration: var(--ls-fx-duration, 24s);
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  opacity: calc(.85 * var(--ls-motion, 1));
}
@keyframes terran-scanner-drift {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(0, 3px, 0); }
}
'''),
    'ZergFamily': dict(
        name='虫族', nameEn='Zerg',
        description='星际争霸 · 虫族：不是造出来的，是长出来的。几丁质甲壳、菌毯、生物荧光；'
                    '没有一条直线，高光向内汇聚而不是向外扩散。',
        accent='#7d3f9c',
        tags=['starcraft', 'zerg', 'organic', 'biomass'],
        param_special=dict(key='creep', label='菌毯密度', group='材质',
                           description='菌毯斑块的密度。0 = 光滑甲壳',
                           default=55),
        light=dict(recessed=(206, 198, 182), raised=(255, 253, 246), page=(221, 214, 198),
                   ink=(46, 36, 54), ink2=(70, 58, 80), ink3=(103, 91, 112),
                   ink4=(131, 119, 140), ink5=(147, 135, 156), inkDim=(203, 194, 208),
                   mixInk=(26, 18, 32), mixBase=(10, 10, 10), deepFill=(26, 18, 32),
                   borderWarm=(128, 116, 108), borderWarm2=(104, 92, 86),
                   mask=(30, 24, 34), mask2=(36, 30, 40), shadow=(64, 54, 68),
                   bluish=(74, 60, 120),
                   error=(168, 50, 50), ok=(95, 138, 58), ok2=(140, 176, 96),
                   warnLabel=(176, 138, 42), warn=(200, 160, 40), warn2=(232, 200, 100),
                   accent=(125, 63, 156), tint=(122, 156, 63), tintDeep=(92, 124, 52),
                   tint_recessed=(212, 218, 190), tint_raised=(238, 242, 214)),
        dark=dict(recessed=(26, 20, 32), raised=(64, 50, 78), page=(23, 18, 27),
                  ink=(222, 212, 230), ink2=(192, 180, 202), ink3=(156, 145, 168),
                  ink4=(135, 124, 147), ink5=(85, 76, 96), inkDim=(182, 172, 194),
                  bluish=(168, 205, 216), borderWarm=(216, 205, 224),
                  mask=(8, 6, 10), mask2=(4, 3, 6), mask3=(28, 22, 34),
                  skeleton=(220, 200, 240), shadow=(0, 0, 0), mixBase=(10, 10, 10),
                  white=(255, 255, 255),
                  accent=(167, 106, 212), tint=(143, 212, 74), tintDeep=(110, 168, 62),
                  error=(255, 130, 130), ok=(150, 210, 110),
                  warn=(232, 185, 35), warn2=(240, 205, 92)),
        locals=[
            ('--ls-glass-alpha', 'calc(.90 - var(--ls-glass, 52) * .0060)'),
            ('--ls-grain-a', 'calc(var(--ls-grain, 50) * .0120)'),
            ('--ls-vig-a', 'calc(var(--ls-vignette, 45) * .0040)'),
            ('--ls-creep-a', 'calc(var(--ls-creep, 55) * .0038)'),
            ('--ls-int', 'calc(var(--ls-intensity, 60) * .01)'),
            ('--ls-creep-eff', 'calc(var(--ls-creep-a) * var(--ls-int))'),
            ('--ls-grain-eff', 'calc(var(--ls-grain-a) * var(--ls-int))'),
            ('--ls-chitin', '#8a7a5e'),
            ('--ls-bile', '#7a9c3f'),
            ('--ls-bloom', '#a76ad4'),
        ],
        materials='''
/* —— 材质：几丁质甲壳 + 菌毯斑块 + 暗角 ——
   没有一条直线；高光从边缘往内收，不是从外打进来的。 */
html[data-live-skin] body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image:
    radial-gradient(circle 9px at 34px 28px, rgba(255, 255, 255, calc(var(--ls-creep-eff) * .55)) 0 40%, transparent 70%),
    radial-gradient(circle 13px at 118px 96px, rgba(0, 0, 0, calc(var(--ls-creep-eff) * .40)) 0 45%, transparent 75%),
    radial-gradient(circle 6px at 190px 44px, rgba(255, 255, 255, calc(var(--ls-creep-eff) * .32)) 0 40%, transparent 70%),
    radial-gradient(140% 110% at 50% 45%, transparent 46%, rgba(0, 0, 0, calc(var(--ls-vig-a) * 1.1)) 100%);
  background-size: 220px 148px, 220px 148px, 220px 148px, 100% 100%;
  background-repeat: repeat, repeat, repeat, no-repeat;
  opacity: calc(.35 + var(--ls-grain-eff) * .65);
}
html[data-live-skin] body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background: radial-gradient(circle 42% at 50% 50%,
    rgba(255, 255, 255, calc(var(--ls-creep-eff) * .10)) 0 60%, transparent 78%);
  animation-name: var(--ls-fx-name, zerg-pulse);
  animation-duration: var(--ls-fx-duration, 9s);
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  opacity: calc(.9 * var(--ls-motion, 1));
}
@keyframes zerg-pulse {
  from { transform: scale(1); opacity: .5; }
  50% { transform: scale(1.045); opacity: 1; }
  to { transform: scale(1); opacity: .5; }
}
'''),
    'ProtossFamily': dict(
        name='神族', nameEn='Protoss',
        description='星际争霸 · 神族：古老、精密、几乎不落地。抛光石材与金、灵能青辉；'
                    '辉光没有一丝模糊，光也没有来源 —— 悬浮自发光。',
        accent='#b8891f',
        tags=['starcraft', 'protoss', 'psionic', 'crystalline'],
        param_special=dict(key='psionic', label='灵能辉光', group='材质',
                           description='灵能导管的辉光强度。0 = 熄灭的古代装置',
                           default=58),
        light=dict(recessed=(214, 210, 198), raised=(255, 255, 252), page=(238, 234, 224),
                   ink=(29, 42, 58), ink2=(52, 66, 84), ink3=(84, 98, 116),
                   ink4=(114, 128, 146), ink5=(132, 146, 164), inkDim=(196, 202, 212),
                   mixInk=(20, 28, 40), mixBase=(10, 10, 10), deepFill=(20, 28, 40),
                   borderWarm=(146, 140, 120), borderWarm2=(118, 112, 94),
                   mask=(26, 30, 40), mask2=(32, 36, 46), shadow=(56, 60, 74),
                   bluish=(31, 74, 99),
                   error=(168, 50, 50), ok=(63, 138, 106), ok2=(110, 176, 150),
                   warnLabel=(184, 134, 11), warn=(200, 160, 30), warn2=(232, 200, 100),
                   accent=(184, 137, 31), tint=(47, 159, 181), tintDeep=(36, 126, 146),
                   tint_recessed=(206, 224, 228), tint_raised=(232, 244, 246)),
        dark=dict(recessed=(19, 28, 44), raised=(48, 62, 88), page=(11, 18, 32),
                  ink=(223, 232, 245), ink2=(192, 204, 222), ink3=(156, 168, 188),
                  ink4=(135, 147, 167), ink5=(85, 95, 115), inkDim=(182, 192, 210),
                  bluish=(168, 205, 216), borderWarm=(216, 224, 236),
                  mask=(6, 9, 16), mask2=(3, 5, 10), mask3=(22, 30, 46),
                  skeleton=(200, 230, 255), shadow=(0, 0, 0), mixBase=(10, 10, 10),
                  white=(255, 255, 255),
                  accent=(232, 198, 90), tint=(79, 212, 232), tintDeep=(56, 168, 188),
                  error=(255, 130, 130), ok=(120, 210, 180),
                  warn=(232, 185, 35), warn2=(240, 205, 92)),
        locals=[
            ('--ls-glass-alpha', 'calc(.90 - var(--ls-glass, 52) * .0060)'),
            ('--ls-grain-a', 'calc(var(--ls-grain, 50) * .0120)'),
            ('--ls-vig-a', 'calc(var(--ls-vignette, 45) * .0040)'),
            ('--ls-psi-a', 'calc(var(--ls-psionic, 58) * .0042)'),
            ('--ls-int', 'calc(var(--ls-intensity, 60) * .01)'),
            ('--ls-psi-eff', 'calc(var(--ls-psi-a) * var(--ls-int))'),
            ('--ls-grain-eff', 'calc(var(--ls-grain-a) * var(--ls-int))'),
            ('--ls-marble', '#ded8ca'),
            ('--ls-gold', '#b8891f'),
            ('--ls-energy', '#4fd4e8'),
        ],
        materials='''
/* —— 材质：悬浮金色细线 + 没有一丝模糊的灵能辉光 ——
   与赛博朋克的分界就在这里：那边是雨幕糊开的 bloom，这边是锐利的、
   边界清楚的光。所以只用 1px 实线与 radial-gradient，不用任何模糊。 */
html[data-live-skin] body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image:
    linear-gradient(90deg, rgba(184, 137, 31, calc(var(--ls-psi-eff) * .9)) 0 64px, transparent 64px),
    linear-gradient(180deg, rgba(184, 137, 31, calc(var(--ls-psi-eff) * .9)) 0 64px, transparent 64px),
    radial-gradient(130% 100% at 50% 50%, transparent 54%, rgba(0, 0, 0, var(--ls-vig-a)) 100%);
  background-size: 480px 320px, 480px 320px, 100% 100%;
  background-position: 56px 48px, 56px 48px, 0 0;
  background-repeat: repeat, repeat, no-repeat;
  opacity: calc(.25 + var(--ls-grain-eff) * .75);
}
html[data-live-skin] body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image:
    radial-gradient(circle 3px at 96px 128px, rgba(79, 212, 232, calc(var(--ls-psi-eff) * 1.2)) 0 45%, transparent 55%),
    radial-gradient(circle 2px at 320px 72px, rgba(79, 212, 232, calc(var(--ls-psi-eff) * .85)) 0 45%, transparent 55%);
  background-size: 420px 240px;
  background-repeat: repeat;
  animation-name: var(--ls-fx-name, protoss-psi-drift);
  animation-duration: var(--ls-fx-duration, 30s);
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  opacity: calc(.9 * var(--ls-motion, 1));
}
@keyframes protoss-psi-drift {
  from { transform: translate3d(0, 0, 0); }
  50% { transform: translate3d(-6px, -3px, 0); }
  to { transform: translate3d(0, 0, 0); }
}
'''),
}


# 追加到 gen-family.py：12 个变体的规格与生成
VARIANTS = {
'TerranFamily': [
 dict(id='DominionOutpost', name='帝国前哨', nameEn='Dominion Outpost', accent='#b8641f',
      desc='标准支 · 橄榄绿 + 炮铜 + 琥珀仪表光，最像「前线基地」的一支',
      defaults=dict(accent='#b8641f', glass=52, scanner=62, intensity=62, grain=54),
      light='''    /* 顶灯从上方压下来，底部有一道地平线 —— 前哨站的围墙 */
    linear-gradient(180deg, rgba(184, 100, 31, .10) 0%, rgba(184, 100, 31, 0) 34%),
    linear-gradient(180deg, rgba(107, 115, 80, .16) 0%, rgba(107, 115, 80, 0) 52%),
    linear-gradient(180deg, rgba(0, 0, 0, 0) 78%, rgba(35, 38, 42, .14) 100%)''',
      dark='''    /* 甲板上的琥珀色仪表背光，只在顶部一小片 */
    radial-gradient(140% 46% at 50% 0%, rgba(224, 138, 52, .16) 0%, rgba(224, 138, 52, 0) 70%),
    linear-gradient(180deg, rgba(255, 255, 255, .05) 0%, rgba(255, 255, 255, 0) 40%),
    linear-gradient(180deg, rgba(0, 0, 0, 0) 70%, rgba(0, 0, 0, .32) 100%)''',
      fx=('terran-outpost-sweep', '34s'),
      kf='''@keyframes terran-outpost-sweep {
  from { transform: translate3d(-1.5%, 0, 0); }
  50% { transform: translate3d(1.5%, 0, 0); }
  to { transform: translate3d(-1.5%, 0, 0); }
}'''),
 dict(id='MarSaraDusk', name='玛萨拉黄昏', nameEn="Mar Sara Dusk", accent='#c2662a',
      desc='边疆 · 锈红棕 + 尘暴橙，全族最暖的一支；天空永远在落尘',
      defaults=dict(accent='#c2662a', glass=46, scanner=38, intensity=66, grain=64),
      light='''    /* 尘暴把地平线以上全部染橙，越往上越薄 */
    linear-gradient(180deg, rgba(194, 102, 42, .34) 0%, rgba(194, 102, 42, .10) 44%, rgba(194, 102, 42, 0) 68%),
    radial-gradient(120% 60% at 78% 88%, rgba(120, 68, 40, .20) 0%, rgba(120, 68, 40, 0) 70%)''',
      dark='''    /* 夜里的尘暴：只剩地平线上一道余烬 */
    linear-gradient(180deg, rgba(0, 0, 0, 0) 52%, rgba(194, 102, 42, .18) 82%, rgba(194, 102, 42, .06) 100%),
    radial-gradient(120% 50% at 74% 96%, rgba(120, 68, 40, .30) 0%, rgba(120, 68, 40, 0) 72%)''',
      fx=('terran-dust-drift', '52s'),
      kf='''@keyframes terran-dust-drift {
  from { transform: translate3d(0, 0, 0); opacity: .75; }
  50% { transform: translate3d(0, -8px, 0); opacity: 1; }
  to { transform: translate3d(0, 0, 0); opacity: .75; }
}'''),
 dict(id='GhostOps', name='幽灵特工', nameEn='Ghost Ops', accent='#d99a2b',
      desc='潜行 · 炭黑 + 琥珀 HUD；对比最强、装饰最少的一支',
      defaults=dict(accent='#d99a2b', glass=30, scanner=78, intensity=44, grain=34),
      light='''    /* HUD 角标：只在左上角画两段线，其余留空 —— 读数界面不该有装饰 */
    linear-gradient(90deg, rgba(217, 154, 43, .55) 0 72px, rgba(217, 154, 43, 0) 72px),
    linear-gradient(180deg, rgba(217, 154, 43, .55) 0 72px, rgba(217, 154, 43, 0) 72px),
    linear-gradient(180deg, rgba(35, 38, 42, .10) 0%, rgba(35, 38, 42, 0) 30%)''',
      dark='''    linear-gradient(90deg, rgba(217, 154, 43, .70) 0 72px, rgba(217, 154, 43, 0) 72px),
    linear-gradient(180deg, rgba(217, 154, 43, .70) 0 72px, rgba(217, 154, 43, 0) 72px),
    radial-gradient(120% 70% at 50% 0%, rgba(217, 154, 43, .10) 0%, rgba(217, 154, 43, 0) 64%)''',
      fx=('terran-hud-scan', '7s'),
      kf='''@keyframes terran-hud-scan {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(0, 3px, 0); }
}'''),
 dict(id='BarracksDeck', name='兵营甲板', nameEn='Barracks Deck', accent='#c9a227',
      desc='内景 · 浅钢灰 + 安全黄；全族最亮的一支，像刚擦过地板的兵营',
      defaults=dict(accent='#c9a227', glass=62, scanner=30, intensity=50, grain=40),
      light='''    /* 地脚的警戒黄斜纹，只占底部一条 */
    repeating-linear-gradient(135deg, rgba(201, 162, 39, .22) 0 14px, rgba(201, 162, 39, 0) 14px 28px),
    linear-gradient(180deg, rgba(255, 255, 255, .55) 0%, rgba(255, 255, 255, 0) 40%)''',
      dark='''    repeating-linear-gradient(135deg, rgba(201, 162, 39, .16) 0 14px, rgba(201, 162, 39, 0) 14px 28px),
    radial-gradient(120% 50% at 50% 0%, rgba(232, 200, 92, .12) 0%, rgba(232, 200, 92, 0) 70%)''',
      fx=('terran-deck-pulse', '16s'),
      kf='''@keyframes terran-deck-pulse {
  from { transform: scale(1); opacity: .55; }
  50% { transform: scale(1.03); opacity: 1; }
  to { transform: scale(1); opacity: .55; }
}'''),
],
'ZergFamily': [
 dict(id='HiveCluster', name='虫巢', nameEn='Hive Cluster', accent='#7d3f9c',
      desc='标准支 · 紫菌毯 + 骨白甲壳，最「在巢里」的一支',
      defaults=dict(accent='#7d3f9c', glass=50, creep=64, intensity=64, grain=58),
      light='''    /* 菌毯从下方爬上来，越往上越稀 */
    radial-gradient(130% 70% at 30% 100%, rgba(125, 63, 156, .26) 0%, rgba(125, 63, 156, 0) 62%),
    radial-gradient(90% 50% at 82% 88%, rgba(122, 156, 63, .18) 0%, rgba(122, 156, 63, 0) 66%)''',
      dark='''    radial-gradient(130% 70% at 30% 100%, rgba(167, 106, 212, .30) 0%, rgba(167, 106, 212, 0) 64%),
    radial-gradient(90% 50% at 82% 88%, rgba(143, 212, 74, .16) 0%, rgba(143, 212, 74, 0) 66%)''',
      fx=('zerg-hive-breathe', '12s'),
      kf='''@keyframes zerg-hive-breathe {
  from { transform: scale(1); opacity: .55; }
  50% { transform: scale(1.06); opacity: 1; }
  to { transform: scale(1); opacity: .55; }
}'''),
 dict(id='BroodPit', name='育雏池', nameEn='Brood Pit', accent='#9c3b3b',
      desc='内脏 · 暗红棕肉膜；全族最沉重的一支',
      defaults=dict(accent='#9c3b3b', glass=40, creep=72, intensity=72, grain=70),
      light='''    /* 肉膜：从中央往外发暗，像一层还在动的组织 */
    radial-gradient(110% 80% at 50% 46%, rgba(156, 59, 59, .22) 0%, rgba(156, 59, 59, 0) 68%),
    radial-gradient(70% 44% at 26% 84%, rgba(96, 40, 34, .20) 0%, rgba(96, 40, 34, 0) 70%)''',
      dark='''    radial-gradient(110% 80% at 50% 46%, rgba(196, 78, 70, .26) 0%, rgba(196, 78, 70, 0) 70%),
    radial-gradient(70% 44% at 26% 84%, rgba(120, 48, 40, .30) 0%, rgba(120, 48, 40, 0) 72%)''',
      fx=('zerg-brood-throb', '6s'),
      kf='''@keyframes zerg-brood-throb {
  from { transform: scale(1); opacity: .6; }
  35% { transform: scale(1.08); opacity: 1; }
  to { transform: scale(1); opacity: .6; }
}'''),
 dict(id='LeviathanHull', name='利维坦', nameEn='Leviathan Hull', accent='#2f9c8f',
      desc='深空生物 · 青绿生物荧光 + 紫黑；全族最冷的一支',
      defaults=dict(accent='#2f9c8f', glass=58, creep=48, intensity=56, grain=44),
      light='''    /* 冷光带：一条横贯的荧光，剩余部分是暗的 */
    linear-gradient(180deg, rgba(47, 156, 143, 0) 40%, rgba(47, 156, 143, .26) 62%, rgba(47, 156, 143, 0) 84%),
    radial-gradient(100% 60% at 50% 100%, rgba(125, 63, 156, .18) 0%, rgba(125, 63, 156, 0) 70%)''',
      dark='''    linear-gradient(180deg, rgba(79, 212, 232, 0) 38%, rgba(47, 200, 180, .22) 62%, rgba(47, 200, 180, 0) 86%),
    radial-gradient(100% 60% at 50% 100%, rgba(167, 106, 212, .22) 0%, rgba(167, 106, 212, 0) 72%)''',
      fx=('zerg-biolum-drift', '22s'),
      kf='''@keyframes zerg-biolum-drift {
  from { transform: translate3d(0, 0, 0); opacity: .7; }
  50% { transform: translate3d(0, -10px, 0); opacity: 1; }
  to { transform: translate3d(0, 0, 0); opacity: .7; }
}'''),
 dict(id='CreepField', name='菌毯', nameEn='Creep Field', accent='#6f9c2f',
      desc='地貌 · 胆汁绿为主；菌毯铺满整片，最平的一支',
      defaults=dict(accent='#6f9c2f', glass=54, creep=84, intensity=58, grain=76),
      light='''    /* 菌毯是平的：只给整片一层薄绿，不做方向性渐变 */
    linear-gradient(180deg, rgba(111, 156, 47, .20) 0%, rgba(111, 156, 47, .10) 100%),
    radial-gradient(80% 40% at 68% 22%, rgba(125, 63, 156, .14) 0%, rgba(125, 63, 156, 0) 68%)''',
      dark='''    linear-gradient(180deg, rgba(143, 212, 74, .16) 0%, rgba(143, 212, 74, .07) 100%),
    radial-gradient(80% 40% at 68% 22%, rgba(167, 106, 212, .18) 0%, rgba(167, 106, 212, 0) 70%)''',
      fx=('zerg-creep-spread', '40s'),
      kf='''@keyframes zerg-creep-spread {
  from { transform: scale(1); }
  50% { transform: scale(1.035); }
  to { transform: scale(1); }
}'''),
],
'ProtossFamily': [
 dict(id='AiurTemple', name='艾尔神殿', nameEn='Aiur Temple', accent='#b8891f',
      desc='标准支 · 大理石 + 金 + 深蓝，最庄重的一支',
      defaults=dict(accent='#b8891f', glass=56, psionic=58, intensity=58, grain=48),
      light='''    /* 神殿的穹顶光：从上方正中泻下的一条 */
    radial-gradient(90% 60% at 50% 0%, rgba(184, 137, 31, .18) 0%, rgba(184, 137, 31, 0) 66%),
    linear-gradient(180deg, rgba(47, 159, 181, .10) 0%, rgba(47, 159, 181, 0) 40%)''',
      dark='''    radial-gradient(90% 60% at 50% 0%, rgba(232, 198, 90, .20) 0%, rgba(232, 198, 90, 0) 68%),
    linear-gradient(180deg, rgba(79, 212, 232, .12) 0%, rgba(79, 212, 232, 0) 42%)''',
      fx=('protoss-temple-shimmer', '26s'),
      kf='''@keyframes protoss-temple-shimmer {
  from { transform: translate3d(0, 0, 0); opacity: .7; }
  50% { transform: translate3d(0, -4px, 0); opacity: 1; }
  to { transform: translate3d(0, 0, 0); opacity: .7; }
}'''),
 dict(id='NexusGrid', name='枢纽网格', nameEn='Nexus Grid', accent='#2f9fb5',
      desc='能量 · 深蓝底上的青色网格；最「在运行」的一支',
      defaults=dict(accent='#2f9fb5', glass=48, psionic=74, intensity=66, grain=52),
      light='''    /* 能量网格：两组正交细线，不模糊 */
    repeating-linear-gradient(90deg, rgba(47, 159, 181, .14) 0 1px, rgba(47, 159, 181, 0) 1px 56px),
    repeating-linear-gradient(180deg, rgba(47, 159, 181, .14) 0 1px, rgba(47, 159, 181, 0) 1px 56px)''',
      dark='''    repeating-linear-gradient(90deg, rgba(79, 212, 232, .20) 0 1px, rgba(79, 212, 232, 0) 1px 56px),
    repeating-linear-gradient(180deg, rgba(79, 212, 232, .20) 0 1px, rgba(79, 212, 232, 0) 1px 56px),
    radial-gradient(120% 70% at 50% 100%, rgba(79, 212, 232, .12) 0%, rgba(79, 212, 232, 0) 70%)''',
      fx=('protoss-grid-flow', '18s'),
      kf='''@keyframes protoss-grid-flow {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(0, 56px, 0); }
}'''),
 dict(id='VoidShard', name='虚空碎片', nameEn='Void Shard', accent='#c9a227',
      desc='虚空 · 暗紫黑 + 金；全族最暗的一支，光只从碎片里透出来',
      defaults=dict(accent='#c9a227', glass=34, psionic=80, intensity=50, grain=42),
      light='''    /* 碎片：两道彼此错开的斜切光，边界锐利 */
    linear-gradient(115deg, rgba(201, 162, 39, 0) 46%, rgba(201, 162, 39, .22) 46.6%, rgba(201, 162, 39, 0) 47.2%),
    linear-gradient(65deg, rgba(90, 60, 140, 0) 58%, rgba(90, 60, 140, .18) 58.6%, rgba(90, 60, 140, 0) 59.2%)''',
      dark='''    linear-gradient(115deg, rgba(232, 198, 90, 0) 46%, rgba(232, 198, 90, .26) 46.6%, rgba(232, 198, 90, 0) 47.2%),
    linear-gradient(65deg, rgba(120, 80, 190, 0) 58%, rgba(120, 80, 190, .22) 58.6%, rgba(120, 80, 190, 0) 59.2%),
    radial-gradient(90% 60% at 30% 20%, rgba(120, 80, 190, .22) 0%, rgba(120, 80, 190, 0) 70%)''',
      fx=('protoss-void-shift', '36s'),
      kf='''@keyframes protoss-void-shift {
  from { transform: translate3d(0, 0, 0); opacity: .65; }
  50% { transform: translate3d(-8px, 5px, 0); opacity: 1; }
  to { transform: translate3d(0, 0, 0); opacity: .65; }
}'''),
 dict(id='Khaydarin', name='凯达林水晶', nameEn='Khaydarin', accent='#3fb8c9',
      desc='水晶 · 青白自发光；全族最亮的一支，像一块还在充能的水晶',
      defaults=dict(accent='#3fb8c9', glass=66, psionic=66, intensity=54, grain=36),
      light='''    /* 晶体的内部折射：三片互相倾斜的亮面 */
    linear-gradient(100deg, rgba(63, 184, 201, 0) 30%, rgba(63, 184, 201, .20) 30.5%, rgba(63, 184, 201, 0) 31.2%),
    linear-gradient(80deg, rgba(255, 255, 255, 0) 62%, rgba(255, 255, 255, .55) 62.4%, rgba(255, 255, 255, 0) 63%),
    radial-gradient(80% 50% at 50% 24%, rgba(63, 184, 201, .20) 0%, rgba(63, 184, 201, 0) 68%)''',
      dark='''    linear-gradient(100deg, rgba(79, 212, 232, 0) 30%, rgba(79, 212, 232, .26) 30.5%, rgba(79, 212, 232, 0) 31.2%),
    linear-gradient(80deg, rgba(255, 255, 255, 0) 62%, rgba(255, 255, 255, .18) 62.4%, rgba(255, 255, 255, 0) 63%),
    radial-gradient(80% 50% at 50% 24%, rgba(79, 212, 232, .26) 0%, rgba(79, 212, 232, 0) 70%)''',
      fx=('protoss-crystal-charge', '20s'),
      kf='''@keyframes protoss-crystal-charge {
  from { transform: scale(1); opacity: .7; }
  50% { transform: scale(1.04); opacity: 1; }
  to { transform: scale(1); opacity: .7; }
}'''),
],
}


def parse_literals(text: str):
    """括号平衡地取出颜色字面量（能处理 alpha 里的 calc(var(…)) 嵌套）。"""
    out = []
    for m in re.finditer(r'\brgba?\(', text):
        depth, i = 0, m.end() - 1
        close = None
        while i < len(text):
            if text[i] == '(':
                depth += 1
            elif text[i] == ')':
                depth -= 1
                if depth == 0:
                    close = i
                    break
            i += 1
        if close is None:
            continue
        bits, depth2, start = [], 0, 0
        inner = text[m.end():close]
        for j, ch in enumerate(inner):
            if ch == '(':
                depth2 += 1
            elif ch == ')':
                depth2 -= 1
            elif ch == ',' and depth2 == 0:
                bits.append(inner[start:j])
                start = j + 1
        bits.append(inner[start:])
        if len(bits) < 3:
            continue
        try:
            rgb = tuple(int(float(b)) for b in bits[:3])
        except ValueError:
            continue
        out.append((m.start(), close + 1, rgb, ','.join(bits[3:]).strip() or None))
    for m in re.finditer(r'#([0-9a-fA-F]{6})\b', text):
        h = m.group(1)
        out.append((m.start(), m.end(), (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)), None))
    return sorted(out)


def classify(role_table: dict, literals: set, dark: bool) -> tuple[list, list]:
    """把模板块里的字面量分成「中性表面 / 带色底纹 / 角色」三类。"""
    neutral, tinted = [], []
    for rgb in literals:
        if rgb in role_table:
            continue
        r, g, b = rgb
        mx, mn = max(rgb), min(rgb)
        sat = 0 if mx == 0 else (mx - mn) / mx
        lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        # 两档的「表面」判据相反：亮色块的表面是亮的，暗色块的是暗的。
        if (lum < 0.5 if not dark else lum > 0.45) or sat > 0.24:
            raise SystemExit(f'{"暗" if dark else "亮"}色块里有既不是表面、又不在角色表里的字面量：{rgb}')
        (tinted if (g > r and g > b) else neutral).append(rgb)
    def key(rgb):
        r, g, b = rgb
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    return sorted(neutral, key=key), sorted(tinted, key=key)


def build_map(spec_mode: dict, role_table: dict, literals: set, dark: bool) -> dict:
    """把模板的颜色字面量映射到本家族的颜色。任何未覆盖的字面量都会报错。"""
    neutral, tinted = classify(role_table, literals, dark)
    table = {}
    for rgb, target in zip(neutral, ladder(spec_mode['recessed'], spec_mode['raised'], len(neutral))):
        table[rgb] = target
    if tinted:
        t = ladder(spec_mode['tint_recessed'], spec_mode['tint_raised'], len(tinted))
        for rgb, target in zip(tinted, t):
            table[rgb] = target
    for rgb, role in role_table.items():
        if role == 'white':
            table[rgb] = (255, 255, 255)
            continue
        if role not in spec_mode:
            raise SystemExit(f'规格缺少角色 {role!r}')
        table[rgb] = spec_mode[role]
    return table


def substitute(text: str, table: dict, where: str) -> str:
    out, pos, missed = [], 0, []
    for s, e, rgb, alpha in parse_literals(text):
        out.append(text[pos:s])
        if rgb not in table:
            missed.append((rgb, alpha))
            out.append(text[s:e])
        else:
            new = table[rgb]
            out.append('#%02x%02x%02x' % new if alpha is None
                       else 'rgba(%d, %d, %d, %s)' % (new[0], new[1], new[2], alpha))
        pos = e
    out.append(text[pos:])
    if missed:
        raise SystemExit(f'{where}: 这些颜色字面量没有映射（模板改过了？）：{sorted(set(missed))}')
    return ''.join(out)


def block(text: str, selector: str) -> str:
    m = re.search(re.escape(selector) + r' \{(.*?)\n\}', text, re.S)
    if m is None:
        raise SystemExit(f'模板里找不到块：{selector}')
    return m.group(1) + '\n'


def params_for(spec: dict) -> list:
    """8 个参数：材质 3 + 氛围 3 + 专属 1 + 通用 1（与其它家族同构）。"""
    sp = spec['param_special']
    return [
        dict(key='glass', type='number', label='玻璃通透度',
             description='面板遮住底纹的程度，越大越透', group='材质',
             min=0, max=100, step=1, default=52),
        dict(key='blur', type='number', label='磨砂强度',
             description='浮层背后的模糊半径', group='材质',
             min=0, max=24, step=1, default=12, unit='px'),
        dict(key=sp['key'], type='number', label=sp['label'], description=sp['description'],
             group=sp['group'], min=0, max=100, step=1, default=sp['default']),
        dict(key='intensity', type='number', label='整体强度',
             description='所有材质层的统一倍率', group='氛围',
             min=0, max=100, step=1, default=60),
        dict(key='accent', type='color', label='强调色',
             description='按钮、链接与描边的色相', group='氛围', default=spec['accent']),
        dict(key='motion', type='boolean', label='动效',
             description='关闭后所有循环动画停止', group='动效', default=True),
        dict(key='vignette', type='number', label='暗角',
             description='画面四周压暗的程度', group='氛围',
             min=0, max=100, step=1, default=45),
        dict(key='grain', type='number', label='底纹保留',
             description='材质层的整体可见度，0 = 完全平坦', group='材质',
             min=0, max=100, step=1, default=50),
    ]


def presets_for() -> list:
    return [
        dict(id='restrained', name='克制', description='材质压到最低，接近纯色界面',
             values=dict(glass=34, blur=8, intensity=30, motion=False, grain=18, vignette=40)),
        dict(id='standard', name='标准', description='默认档位', values=dict()),
        dict(id='cinematic', name='电影感', description='材质与动效拉满',
             values=dict(glass=74, blur=20, intensity=92, motion=True, grain=88, vignette=62)),
    ]


def write_variants(family: str, dry: bool) -> list[str]:
    out = []
    for spec in VARIANTS.get(family, []):
        fx_name, fx_dur = spec['fx']
        css = f"""/* {spec['name']} {spec['nameEn']} —— {spec['desc']}
   ==========================================================================
   家族层提供调色板、token 与材质骨架；这一支只表达差异：
   壁纸、动效签名、强调色与几个参数默认值。

   壁纸**只用带 alpha 的颜色**（`rgba(…, .xx)`）。不透明色会把页面在某一档里
   直接翻成另一种极性，而 token 是按档走的 —— 那正是「暗色档整页看不见」
   和「亮色档拿到暗壁纸」的成因。 */
html[data-live-skin] body:not([data-ds-dark-theme]) {{
  background-image:
{spec['light']};
  background-repeat: no-repeat;
  background-attachment: fixed;
}}

html[data-live-skin] body[data-ds-dark-theme] {{
  background-image:
{spec['dark']};
  background-repeat: no-repeat;
  background-attachment: fixed;
}}

/* 动效签名：家族层把它挂在 body::after 上，这里只换名字与周期。 */
html[data-live-skin] body {{
  --ls-fx-name: {fx_name};
  --ls-fx-duration: {fx_dur};
}}

{spec['kf']}
"""
        skin = dict(
            manifestVersion=1,
            name=spec['name'], nameEn=spec['nameEn'], description=spec['desc'],
            accent=spec['accent'], tags=[family.replace('Family', '').lower(), spec['id'].lower()],
            defaults=spec['defaults'], styles=['skin.css'],
        )
        if not dry:
            d = SKINS / family / spec['id']
            d.mkdir(parents=True, exist_ok=True)
            (d / 'skin.css').write_text(css, encoding='utf8')
            (d / 'skin.json').write_text(json.dumps(skin, ensure_ascii=False, indent=2) + '\n',
                                         encoding='utf8')
        out.append(spec['id'])
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('family', nargs='?')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--dry', action='store_true')
    args = ap.parse_args()

    if args.list or args.family is None:
        for fid in SPECS:
            print(f'  {fid:18s} {SPECS[fid]["name"]} {SPECS[fid]["nameEn"]}')
        return
    if args.family not in SPECS:
        raise SystemExit(f'没有这个家族的规格：{args.family}')
    spec = SPECS[args.family]

    tpl = (SKINS / TEMPLATE / 'base.css').read_text(encoding='utf8')
    light_src = block(tpl, 'html[data-live-skin] body:not([data-ds-dark-theme])')
    dark_src = block(tpl, 'html[data-live-skin] body[data-ds-dark-theme]')

    light_table = build_map(spec['light'], T_LIGHT_ROLE, {l[2] for l in parse_literals(light_src)}, False)
    dark_table = build_map(spec['dark'], T_DARK_ROLE, {l[2] for l in parse_literals(dark_src)}, True)

    light_css = substitute(light_src, light_table, f'{args.family} 亮色块')
    dark_css = substitute(dark_src, dark_table, f'{args.family} 暗色块')

    # 专属参数的 cssVar 不能与皮肤自己的局部变量撞名（C10），
    # 也不能被家族 CSS 重复声明（C11/C12 那一族）。
    special = spec['param_special']['key']
    for name, _v in spec['locals']:
        if name == f'--ls-{special}':
            raise SystemExit(f'局部变量与参数密码撞名：{name}')

    locals_css = ''.join(f'  {n}: {v};\n' for n, v in spec['locals'])
    # CSS 里有大量 % （渐变百分比），所以不能用 %-格式化；用 f-string 与预算好的十六进制。
    page_light_hex = '#%02x%02x%02x' % spec['light']['page']
    page_dark_hex = '#%02x%02x%02x' % spec['dark']['page']

    base = f'''/* ==========================================================================
   {spec["name"]} {spec["nameEn"]} —— 大类层
   {spec["description"]}
   ========================================================================== */

/* —— 由参数派生的中间量。两档共用，所以留在无档位的 body 规则里（C12）。 —— */
html[data-live-skin] body {{
{locals_css}}}

/* ==========================================================================
   亮色档：限定为只在亮色档生效。
   若这一层不限定，它在暗色档会因为特异性（(0,1,2) > 官方暗色块的 (0,1,1)）
   压过官方暗色值 —— 那就是「暗色档里输入框还是亮的」那个故障。
   ========================================================================== */
html[data-live-skin] body:not([data-ds-dark-theme]) {{
{light_css}}}

/* ==========================================================================
   暗色档：**独立的一套调色板**，不是把亮色值压深。
   ========================================================================== */
html[data-live-skin] body[data-ds-dark-theme] {{
{dark_css}  /* 暗色档必须重画 body 底色：底色与材质都写在无档位的 body 规则里。 */
  background-color: {page_dark_hex};
}}

/* ==========================================================================
   页面底色与壁纸
   ========================================================================== */
html[data-live-skin] body {{
  background-color: {page_light_hex};
  background-repeat: no-repeat;
  background-attachment: fixed;
}}
{spec["materials"]}
/* ==========================================================================
   浮层表面：只给小面积、浮在内容之上的地方用磨砂
   ========================================================================== */
html[data-live-skin] [data-dsh-surface='composer'],
html[data-live-skin] [data-dsh-surface='session-header'],
html[data-live-skin] [role='dialog'],
html[data-live-skin] [role='menu'],
html[data-live-skin] [role='tooltip'] {{
  backdrop-filter: blur(var(--ls-blur, 12px)) saturate(1.1);
}}

html[data-live-skin] body ::selection {{
  background-color: color-mix(in srgb, var(--ls-accent, {spec["accent"]}) 32%, transparent);
}}
'''

    family_json = dict(
        manifestVersion=1,
        name=spec['name'],
        nameEn=spec['nameEn'],
        description=spec['description'],
        accent=spec['accent'],
        tags=spec['tags'],
        styles=['base.css'],
        params=params_for(spec),
        presets=presets_for(),
    )

    target = SKINS / args.family
    if args.dry:
        print(f'{args.family}: base.css {base.count(chr(10))} 行，'
              f'亮色 {light_css.count("--dsw-")} token / 暗色 {dark_css.count("--dsw-")} token')
        return
    target.mkdir(parents=True, exist_ok=True)
    (target / 'base.css').write_text(base, encoding='utf8')
    (target / 'family.json').write_text(
        json.dumps(family_json, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    made = write_variants(args.family, dry=False)
    print(f'✓ {args.family}: 写出 family.json 与 base.css'
          f'（亮 {light_css.count("--dsw-")} / 暗 {dark_css.count("--dsw-")} 个 token）'
          f'，以及 {len(made)} 个变体：{" ".join(made)}')


if __name__ == '__main__':
    main()
