#!/usr/bin/env python3
"""给 LiveSkin 皮肤生成「零件级 token」的暗色对应。

背景
----
皮肤要么是「亮色默认 + 暗色覆盖」，要么是「暗色默认 + 亮色微调」。前者往往只在暗色块里
写了主体面（bg-base / layers / labels / borders），剩下的零件级 token（遮罩、滚动条、
状态色、markdown 芯片、按钮变体、交互底色、阴影）在暗色档会沿用浅色值或落回官方中性色。
这个脚本按一套**可复核**的规则把浅色块的值搬到暗色梯子上。

规则（不含「猜」）
----------------
A. 原样保留：强调色及其底纹（强调色与模式无关）、深色遮罩。
B. 显式替换：墨色、暖灰描边、状态色等角色明确的字面量，逐条列在 PER_FAMILY 里。
C. 表面色：低饱和亮色按**亮度位置线性插值**到暗色梯子（最亮的抬起面 ↔ 最亮的暗面）。
   只换 RGB，alpha 表达式原样保留。
D. 半透明白：不在 A 里的按固定比例压暗成暗档上的微弱高光。
E. 语义由 token 决定、不由颜色决定 —— 同一个 RGB 可能是墨色正文，也可能是深色蒙层：
   · 遮罩类（--dsw-alias-bg-mask-*）保持深色
   · label-primary-foreground 与按钮填充两档同值（深底白字）
   · 其余按名字走 OVERRIDE 表
F. 表外的一律报出来，不静默处理。

用法
----
    python3 scripts/gen-dark-parity.py --check          # 只报每个家族还缺哪些 token
    python3 scripts/gen-dark-parity.py --emit <Family>  # 打印生成的暗色声明

生成结果需要人工过一眼再写进对应的暗色块；写完后跑验收台，C4 会把关。
"""
from __future__ import annotations

import argparse
import pathlib
import re

SKINS = pathlib.Path(__file__).resolve().parent.parent / 'skins'
def _theme_client_js() -> pathlib.Path | None:
    """在 profile 与 npx 缓存里找已安装的官方主题插件。"""
    import os
    roots = []
    home = pathlib.Path(os.environ.get('DSH_HOME', pathlib.Path.home() / '.dsh'))
    roots += sorted((home / 'profiles').glob('*/node_modules'))
    roots += sorted((pathlib.Path.home() / '.npm' / '_npx').glob('*/node_modules'))
    for root in roots:
        p = root / '@deepseek-ai' / 'dsh-client-ui-theme' / 'lib' / 'client.js'
        if p.exists():
            return p
    return None

# --------------------------------------------------------------------------
# 字面量扫描：必须括号平衡。alpha 里可能是 calc(var(--x) + .2)，嵌套两层，
# 正则只能吃一层 —— 吃不下就静默跳过，等于没检查。
# --------------------------------------------------------------------------
HEX = re.compile(r'#([0-9a-fA-F]{6})\b')
COLORFN = re.compile(r'\brgba?\(')


def _balanced(text: str, open_idx: int) -> int | None:
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == '(':
            depth += 1
        elif text[i] == ')':
            depth -= 1
            if depth == 0:
                return i
    return None


def _split_top(text: str) -> list[str]:
    out, depth, start = [], 0, 0
    for i, ch in enumerate(text):
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        elif ch == ',' and depth == 0:
            out.append(text[start:i])
            start = i + 1
    out.append(text[start:])
    return [x.strip() for x in out]


def literals(text: str) -> list[tuple[int, int, tuple[int, int, int], str | None]]:
    out = []
    for m in COLORFN.finditer(text):
        close = _balanced(text, m.end() - 1)
        if close is None:
            continue
        bits = _split_top(text[m.end():close])
        if len(bits) < 3:
            continue
        try:
            rgb = tuple(int(float(b)) for b in bits[:3])
        except ValueError:
            continue
        alpha = ','.join(bits[3:]).strip() if len(bits) > 3 else None
        out.append((m.start(), close + 1, rgb, alpha))
    for m in HEX.finditer(text):
        h = m.group(1)
        out.append((m.start(), m.end(), (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)), None))
    return sorted(out)


def lum(rgb: tuple[int, int, int]) -> float:
    def f(c: int) -> float:
        s = c / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])


def sat(rgb: tuple[int, int, int]) -> float:
    mx, mn = max(rgb), min(rgb)
    return 0 if mx == 0 else (mx - mn) / mx


# --------------------------------------------------------------------------
# 每个家族一张配置：暗色梯子、强调色、保留集、显式替换表、按 token 的覆盖。
# --------------------------------------------------------------------------
PER_FAMILY: dict[str, dict] = {
    'AtompunkFamily': dict(
        ladder=[(36, 38, 40), (44, 46, 48), (52, 54, 56), (60, 62, 64), (68, 70, 72), (76, 78, 80)],
        accent=(228, 87, 46),
        keep_rgba={((255, 255, 255), '.6'), ((255, 255, 255), '.4'), ((24, 20, 17), '.86')},
        keep_rgb={(168, 205, 187), (120, 178, 158), (10, 10, 10), (232, 185, 35), (240, 205, 92)},
        explicit={(43, 38, 34): (238, 241, 243), (120, 110, 96): (216, 221, 226),
                  (31, 74, 99): (168, 205, 216), (58, 51, 44): (182, 189, 194),
                  (243, 235, 221): (38, 40, 42), (255, 255, 255): (76, 78, 80),
                  (242, 236, 226): (52, 54, 56), (248, 244, 236): (68, 70, 72),
                  (207, 58, 31): (255, 138, 106), (63, 138, 99): (120, 201, 155),
                  (98, 168, 132): (168, 205, 187), (168, 106, 18): (240, 205, 92),
                  (60, 50, 40): (0, 0, 0)},
        keep_asis=set(),
        override={'--dsw-alias-interactive-bg-hover': 'rgba(238, 241, 243, .1)'},
    ),
    'SolarpunkFamily': dict(
        ladder=[(24, 30, 20), (32, 40, 27), (40, 50, 34), (48, 60, 41), (56, 70, 48), (64, 80, 55)],
        accent=(193, 102, 59),
        keep_rgba={((255, 255, 255), '.66'), ((255, 255, 255), '.44'),
                   ((22, 28, 18), '.86'), ((28, 36, 22), '.48')},
        keep_rgb={(168, 207, 196), (201, 162, 39), (221, 190, 92), (107, 127, 74)},
        explicit={(38, 48, 31): (238, 243, 230), (247, 244, 236): (26, 32, 22),
                  (255, 255, 255): (64, 80, 55), (31, 74, 99): (168, 205, 216),
                  (51, 63, 40): (190, 198, 182), (163, 58, 42): (255, 150, 120),
                  (79, 122, 78): (150, 200, 150), (176, 138, 58): (240, 205, 120),
                  (60, 56, 40): (0, 0, 0), (61, 90, 52): (0, 0, 0),
                  (176, 74, 44): (255, 150, 120), (200, 111, 82): (230, 150, 120),
                  (92, 138, 60): (150, 200, 150), (127, 174, 87): (170, 210, 150),
                  (154, 116, 24): (240, 205, 120)},
        keep_asis={'--dsw-alias-label-primary-foreground', '--dsw-alias-button-primary-fill',
                   '--dsw-alias-button-primary-hover', '--dsw-alias-button-info-fill',
                   '--dsw-alias-button-info-hover'},
        override={},
    ),
}

MASK = re.compile(r'--dsw-alias-bg-mask-(1|2|3|photo)$')


def official_dark_tokens() -> list[str]:
    path = _theme_client_js()
    if path is not None:
        src = path.read_text(encoding='utf8')
        best: list[str] = []
        for m in re.finditer(r'body\[data-ds-dark-theme\]\s*\{((?:--dsw-[^{}]*?)+)\}', src):
            d = [x.split(':')[0].strip() for x in m.group(1).split(';') if ':' in x]
            if len(d) > len(best):
                best = d
        if best:
            return best
    return []


def blocks(family: str) -> tuple[str, str]:
    s = (SKINS / family / 'base.css').read_text(encoding='utf8')
    light = re.search(r'html\[data-live-skin\] body:not\(\[data-ds-dark-theme\]\) \{(.*?)\n\}', s, re.S)
    dark = re.search(r'html\[data-live-skin\] body\[data-ds-dark-theme\] \{(.*?)\n\}', s, re.S)
    return (light.group(1) if light else ''), (dark.group(1) if dark else '')


def missing(family: str) -> list[tuple[str, str]]:
    light, dark = blocks(family)
    declared = set(re.findall(r'(--dsw-[\w-]+)\s*:', dark))
    return [(k, v) for k, v in re.findall(r'(--dsw-[\w-]+)\s*:\s*([^;]+);', light) if k not in declared]


def emit(family: str) -> list[str]:
    cfg = PER_FAMILY[family]
    light, _ = blocks(family)
    ladder = sorted(cfg['ladder'], key=lum)
    accent, keep_rgb, keep_rgba = cfg['accent'], cfg['keep_rgb'], cfg['keep_rgba']

    surfaces: dict[tuple[int, int, int], float] = {}
    for _s, _e, rgb, ak in literals(light):
        if rgb in cfg['explicit'] or rgb == accent or rgb in keep_rgb:
            continue
        if rgb == (255, 255, 255) and ak is not None:
            continue
        if lum(rgb) >= 0.55 and sat(rgb) <= 0.16:
            surfaces[rgb] = lum(rgb)
    lo, hi = min(surfaces.values()), max(surfaces.values())

    def ramp(rgb):
        t = 0.0 if hi == lo else (lum(rgb) - lo) / (hi - lo)
        x = t * (len(ladder) - 1)
        i = min(int(x), len(ladder) - 2)
        f = x - i
        return tuple(round(ladder[i][k] * (1 - f) + ladder[i + 1][k] * f) for k in range(3))

    out, missed = [], []
    for key, value in missing(family):
        if key in cfg['keep_asis']:
            out.append(f'  {key}: {value};')
            continue
        if key in cfg['override']:
            out.append(f'  {key}: {cfg["override"][key]};')
            continue
        pieces, pos = [], 0
        for s0, e0, rgb, ak in literals(value):
            pieces.append(value[pos:s0])
            akk = None if ak is None else re.sub(r'\s+', '', ak)
            if (rgb, akk) in keep_rgba or rgb == accent or rgb in keep_rgb:
                pieces.append(value[s0:e0])
            elif rgb in cfg['explicit']:
                new = cfg['explicit'][rgb]
                pieces.append(f'#{new[0]:02x}{new[1]:02x}{new[2]:02x}' if ak is None
                              else f'rgba({new[0]}, {new[1]}, {new[2]}, {ak})')
            elif ak is not None and rgb == (255, 255, 255):
                a = float(re.match(r'^([\d.]*)', akk).group(1) or 0)
                pieces.append(f'rgba(238, 241, 243, {max(0.06, a * 0.16):g})')
            elif rgb in surfaces:
                new = ramp(rgb)
                pieces.append(f'#{new[0]:02x}{new[1]:02x}{new[2]:02x}' if ak is None
                              else f'rgba({new[0]}, {new[1]}, {new[2]}, {ak})')
            else:
                missed.append((key, rgb, ak))
                pieces.append(value[s0:e0])
            pos = e0
        pieces.append(value[pos:])
        line = ''.join(pieces)
        if MASK.search(key):
            def black(m):
                rgb = tuple(int(float(x)) for x in m.group(1, 2, 3))
                return m.group(0) if lum(rgb) < 0.2 else f'rgba(0, 0, 0, {m.group(4)})'
            line = re.sub(r'rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([^()]*(?:\([^()]*\)[^()]*)*)\)', black, line)
        out.append(f'  {key}: {line};')
    for item in missed:
        print(f'  ！表外字面量 {item}')
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--check', action='store_true', help='只报每个家族还缺哪些 token')
    ap.add_argument('--emit', metavar='FAMILY', help='打印该家族生成的暗色声明')
    args = ap.parse_args()

    if args.emit:
        for line in emit(args.emit):
            print(line)
        return

    tokens = official_dark_tokens()
    print(f'官方暗色 token {len(tokens)} 个')
    for family in sorted(p.name for p in SKINS.iterdir() if (p / 'family.json').exists()):
        light, dark = blocks(family)
        if not light:
            print(f'  {family:24s} 没有「亮色限定」块 —— 默认块本身就是暗色，无需补齐')
            continue
        declared = set(re.findall(r'(--dsw-[\w-]+)\s*:', dark))
        if not dark:
            # 没有暗色块时，要看默认块本身是不是暗色：是暗色就说明它两档通用，无需补齐。
            src = (SKINS / family / 'base.css').read_text(encoding='utf8')
            default = re.search(r'html\[data-live-skin\] body \{(.*?)\n\}', src, re.S)
            base = re.search(r'--dsw-alias-bg-base\s*:\s*([^;]+)', default.group(1)) if default else None
            hit = literals(base.group(1)) if base else []
            if hit and lum(hit[0][2]) < 0.2:
                print(f'  {family:24s} 默认块本身就是暗色（bg-base 亮度 {lum(hit[0][2]):.3f}）—— 两档通用，无需补齐')
                continue
        left = [t for t in tokens if t not in declared]
        print(f'  {family:24s} 暗色块 {len(declared):3d}  缺 {len(left):3d}'
              + ('  ✓' if not left else '  ' + ' '.join(left)))


if __name__ == '__main__':
    main()
