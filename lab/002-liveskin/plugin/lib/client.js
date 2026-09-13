/**
 * LiveSkin —— 客户端半边。
 *
 * 三个部分：
 *   1. host API 客户端（/api/live-skin/v1）
 *   2. runtime：把一套皮肤画到 DOM 上（style 标签 + html[data-live-skin] + --ls-* 变量）
 *   3. 设置分区 UI：大类 / 小类 / 预设三级导航 + 由参数 schema 自动生成的控件
 *
 * 没有构建步骤，所以这里不用 JSX，全部走 React.createElement。
 */
window.__ModuleLoader__.load({
  id: 'dsh-live-skin',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const NS = 'live-skin'
    const API = '/api/live-skin/v1'
    const STYLE_TAG_ID = 'dsh-live-skin/skin.css'
    const ROOT_ATTRIBUTE = 'liveSkin'

    // -----------------------------------------------------------------------
    // host API
    // -----------------------------------------------------------------------

    async function apiGet(path) {
      const response = await fetch(API + path, { headers: { accept: 'application/json' } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? `HTTP ${String(response.status)}`)
      return data
    }

    async function apiPost(path, body) {
      const response = await fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? `HTTP ${String(response.status)}`)
      return data
    }

    // -----------------------------------------------------------------------
    // runtime
    // -----------------------------------------------------------------------

    /**
     * 参数值 → 要写进 DOM 的变量表。
     * 普通参数一行；enum 选项可以额外带 `-dark` 一行，让官方壳层的
     * body[data-ds-dark-theme] 拿到另一套载荷。
     */
    function paramVars(param, value) {
      if (param.type === 'enum') {
        const option = (param.options ?? []).find((entry) => entry.value === value)
        if (option !== undefined) {
          const out = [[param.cssVar, typeof option.css === 'string' ? option.css : String(value ?? '')]]
          if (typeof option.cssDark === 'string') out.push([`${param.cssVar}-dark`, option.cssDark])
          return out
        }
        return [[param.cssVar, String(value ?? '')]]
      }
      if (param.type === 'number') return [[param.cssVar, `${String(value)}${param.unit ?? ''}`]]
      if (param.type === 'boolean') return [[param.cssVar, value ? '1' : '0']]
      return [[param.cssVar, String(value ?? '')]]
    }

    /**
     * 客户端侧的值收束，规则必须与宿主半边的 coerceValue 逐例一致：
     * 域内的原样返回（数字夹进区间），域外的回落到该参数的默认值。
     * 存在两份是因为预览不能等一次往返；测试台 7b 段会拿两个实现对照。
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
          return (param.options ?? []).some((option) => option.value === value) ? value : null
        case 'text':
          return typeof value === 'string' ? value : null
        default:
          return null
      }
    }

    function coerceParamValue(param, value) {
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
          return (param.options ?? [{ value: '' }])[0].value
        default:
          return ''
      }
    }

    /**
     * DOM 上的这套皮肤。applied* 是「已提交」的那份，preview 只是临时覆盖变量；
     * 设置面板关掉时会 restore() 回到已提交状态。
     */
    const runtime = {
      styleEl: null,
      cssKey: null,
      paintedKey: null,
      paintedParams: [],
      paintedValues: {},
      vars: new Set(),
      /** 上一次写进 DOM 的变量取值，供面板里的变量表直接展示。 */
      lastVars: {},
      appliedKey: null,
      appliedParams: [],
      appliedValues: {},
      appliedCss: '',

      ensureStyle() {
        if (this.styleEl !== null && this.styleEl.isConnected) return this.styleEl
        let el = document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`)
        if (el === null) {
          el = document.createElement('style')
          el.dataset.plugin = 'dsh-live-skin'
          el.dataset.pluginCss = STYLE_TAG_ID
          document.head.appendChild(el)
        }
        this.styleEl = el
        return el
      },

      writeVars(params, values) {
        const root = document.documentElement
        for (const param of params) {
          for (const [name, literal] of paramVars(param, values[param.key])) {
            root.style.setProperty(name, literal)
            this.vars.add(name)
            this.lastVars[name] = literal
          }
        }
      },

      clearVars() {
        const root = document.documentElement
        for (const name of this.vars) root.style.removeProperty(name)
        this.vars.clear()
        this.lastVars = {}
      },

      /** 当前写进 DOM 的变量表（已排序的普通对象，可直接渲染）。 */
      snapshotVars() {
        const out = {}
        for (const name of Object.keys(this.lastVars).sort()) out[name] = this.lastVars[name]
        return out
      },

      /** 换一套皮肤（含样式表）；同 key 且 CSS 未变时只重写变量。 */
      paint(key, params, values, css) {
        if (css !== undefined && this.cssKey !== key) {
          this.ensureStyle().textContent = css
          this.cssKey = key
        }
        this.clearVars()
        document.documentElement.dataset[ROOT_ATTRIBUTE] = key
        this.writeVars(params, values)
        this.paintedKey = key
        this.paintedParams = params
        this.paintedValues = { ...values }
      },

      /** 只改参数、不换皮肤 —— 预览拖动走这条路。 */
      preview(params, values) {
        this.clearVars()
        this.writeVars(params, values)
        this.paintedParams = params
        this.paintedValues = { ...values }
      },

      /** 记住「已提交」的这一份。 */
      commit(key, params, values, css) {
        this.appliedKey = key
        this.appliedParams = params
        this.appliedValues = { ...values }
        if (css !== undefined) this.appliedCss = css
      },

      /** 回到已提交状态。 */
      restore() {
        if (this.appliedKey === null) {
          this.clear()
          return
        }
        this.paint(this.appliedKey, this.appliedParams, this.appliedValues, this.appliedCss)
      },

      clear() {
        this.clearVars()
        if (this.styleEl !== null) this.styleEl.textContent = ''
        this.cssKey = null
        this.paintedKey = null
        delete document.documentElement.dataset[ROOT_ATTRIBUTE]
      },

      dispose() {
        this.clearVars()
        if (this.styleEl !== null && this.styleEl.isConnected) this.styleEl.remove()
        this.styleEl = null
        this.cssKey = null
        this.appliedKey = null
        delete document.documentElement.dataset[ROOT_ATTRIBUTE]
      }
    }

    function skinKey(familyId, variantId) {
      return `${familyId}/${variantId}`
    }

    /** 样式表按 skin key 缓存：同一套皮肤反复试穿不必重取。 */
    const skinCssCache = new Map()

    let bootError = null
    let bootCancelled = false

    async function fetchSkinCss(familyId, variantId) {
      const key = skinKey(familyId, variantId)
      if (skinCssCache.has(key)) return skinCssCache.get(key)
      const response = await fetch(`${API}/skin/${encodeURIComponent(familyId)}/${encodeURIComponent(variantId)}/css`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error ?? `找不到样式层（HTTP ${String(response.status)}）`)
      }
      const text = await response.text()
      skinCssCache.set(key, text)
      return text
    }

    /**
     * 解析「这一刻该生效的是哪一套皮肤」，并把样式表一并取回。
     * 启动恢复与面板初次渲染共用这一条路径，保证两边看到的是同一份事实。
     */
    async function resolveActive() {
      const [catalog, state] = await Promise.all([apiGet('/catalog'), apiGet('/state')])
      const active = typeof catalog.active === 'string' ? catalog.active : null
      const target = active === null ? null : active.split('/')
      const preferred = target === null ? null : catalog.families.find((entry) => entry.id === target[0]) ?? null
      const family = preferred ?? (catalog.families.length > 0 ? catalog.families[0] : null)
      if (family === null) {
        return { catalog, state, active, familyId: null, variantId: null, variant: null, values: {}, css: '' }
      }
      const variant = (target !== null ? family.variants.find((entry) => entry.id === target[1]) : null) ?? family.variants[0]
      const key = skinKey(family.id, variant.id)
      const values = { ...variant.defaults, ...((state.resolved ?? {})[key] ?? {}) }
      const css = active === key ? await fetchSkinCss(family.id, variant.id) : ''
      return { catalog, state, active, familyId: family.id, variantId: variant.id, variant, values, css }
    }

    /**
     * 页面一加载就把已保存的皮肤画上去 —— 这是「应用」能跨刷新存活的那一步。
     * 没有已保存的皮肤时什么都不画，绝不擅自替用户换脸。
     */
    async function bootActiveSkin() {
      try {
        const snapshot = await resolveActive()
        if (bootCancelled) return
        if (snapshot.active !== null && snapshot.css.length > 0 && snapshot.variant !== null) {
          runtime.commit(snapshot.active, snapshot.variant.params, snapshot.values, snapshot.css)
          runtime.paint(snapshot.active, snapshot.variant.params, snapshot.values, snapshot.css)
        }
      } catch (cause) {
        bootError = cause instanceof Error ? cause.message : String(cause)
        console.error('live-skin: 启动恢复失败 —', bootError)
      }
    }

    // -----------------------------------------------------------------------
    // 样式
    // -----------------------------------------------------------------------

    const UI_CSS = `
      [data-live-skin-panel] { display:flex; flex-direction:column; gap:16px; }
      [data-live-skin-panel] .ls-head { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
      [data-live-skin-panel] .ls-title { font:var(--dsw-font-m-18); font-weight:600; color:var(--dsw-alias-label-primary); }
      [data-live-skin-panel] .ls-muted { color:var(--dsw-alias-label-tertiary); font:var(--dsw-font-xxs-12); }
      [data-live-skin-panel] .ls-group { display:flex; flex-direction:column; gap:8px; }
      [data-live-skin-panel] .ls-group-label { font:var(--dsw-font-xxs-strong-12); color:var(--dsw-alias-label-secondary); text-transform:none; }
      [data-live-skin-panel] .ls-chips { display:flex; flex-wrap:wrap; gap:6px; }
      /* 分类行：所有行**共用一个网格**（行用 display:contents 参与外层网格），
         所以标签列的宽度是全分类里最宽的那个，各行的家族 chip 左边缘是对齐的。
         标签左对齐并贴着列首 —— 定宽右对齐会在短标签左侧留出一块空白。
         不用分割线：标签本身已经足够分组，加线只会让面板更吵。 */
      [data-live-skin-panel] .ls-cat-rows { display:grid; grid-template-columns:max-content 1fr;
        column-gap:12px; row-gap:7px; align-items:start; }
      [data-live-skin-panel] .ls-cat-row { display:contents; }
      [data-live-skin-panel] .ls-cat-label { display:flex; align-items:baseline; gap:6px;
        font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-secondary);
        padding-top:5px; text-align:left; white-space:nowrap; }
      /* 排序依据：比分类名更弱一档，句首加一个中点作分隔 */
      [data-live-skin-panel] .ls-cat-basis { color:var(--dsw-alias-label-tertiary); font-weight:400; }
      [data-live-skin-panel] .ls-cat-basis::before { content:'·'; margin-right:3px; }
      [data-live-skin-panel] .ls-cat-rows[data-plain="true"] { grid-template-columns:1fr; }
      [data-live-skin-panel] .ls-chip { border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1);
        color:var(--dsw-alias-label-secondary); border-radius:999px; padding:4px 12px; cursor:pointer; font:var(--dsw-font-xxs-12); }
      [data-live-skin-panel] .ls-chip:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-secondary); }
      [data-live-skin-panel] .ls-chip[data-on="true"] { background:var(--dsw-alias-button-primary-fill); border-color:transparent;
        color:var(--dsw-alias-label-primary-foreground); }
      [data-live-skin-panel] .ls-cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(210px, 1fr)); gap:10px; }
      [data-live-skin-panel] .ls-card { text-align:left; border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1);
        border-radius:12px; padding:10px 12px; cursor:pointer; display:flex; flex-direction:column; gap:4px;
        color:var(--dsw-alias-label-primary); font:var(--dsw-font-s-14); }
      [data-live-skin-panel] .ls-card:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
      [data-live-skin-panel] .ls-card[data-on="true"] { border-color:var(--dsw-alias-brand-primary); box-shadow:0 0 0 1px var(--dsw-alias-brand-primary) inset; }
      /* 正在使用的皮肤要一眼可辨：左侧强调条 + 「使用中」胶囊。
         它与 [data-on]（正在查看）是两件事 —— 用户浏览别的皮肤时，
         仍然需要知道哪一套在生效，好在切走之后找回来。 */
      [data-live-skin-panel] .ls-card[data-applied="true"] { border-color:var(--dsw-alias-brand-primary);
        box-shadow:inset 3px 0 0 0 var(--dsw-alias-brand-primary); background:var(--dsw-alias-bg-layer-2); }
      [data-live-skin-panel] .ls-card[data-applied="true"][data-on="true"] { box-shadow:0 0 0 1px var(--dsw-alias-brand-primary) inset, inset 3px 0 0 0 var(--dsw-alias-brand-primary); }
      [data-live-skin-panel] .ls-now { font:var(--dsw-font-xxxs-11); font-weight:600; flex:none;
        background:var(--dsw-alias-button-primary-fill); color:var(--dsw-alias-label-primary-foreground);
        border-radius:999px; padding:1px 7px; }
      /* 「使用中」只加一圈描边，**不碰文字色**：选中态的底色是强调色填充，
         文字色必须留给 [data-on] 那条规则钉住的白。两者同特异性，这里一旦写 color，
         源码在后的它就会把白字盖成深墨色 —— 亮色档下深底压深字。
         （验收台 [7c] 有专门一条守着这个形态。） */
      [data-live-skin-panel] .ls-chip[data-applied="true"] { box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary); }
      [data-live-skin-panel] .ls-card-foot { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
      /* 档位徽章：亮/暗跟随系统 = 中性；只有一种观感 = 明确标出是哪一种 */
      [data-live-skin-panel] .ls-mode { font:var(--dsw-font-xxxs-11); border-radius:4px; padding:0 5px; flex:none;
        border:1px solid var(--dsw-alias-border-l2); color:var(--dsw-alias-label-tertiary); }
      [data-live-skin-panel] .ls-mode[data-mode="light"] { border-color:var(--dsw-alias-border-l3); color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-2); }
      [data-live-skin-panel] .ls-mode[data-mode="dark"] { border-color:var(--dsw-alias-border-l3); color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-3); }
      [data-live-skin-panel] .ls-mode[data-mode="both"] { color:var(--dsw-alias-label-secondary); }
      [data-live-skin-panel] .ls-card-name { font-weight:600; display:flex; align-items:center; gap:6px; }
      [data-live-skin-panel] .ls-swatch { width:10px; height:10px; border-radius:50%; flex:none; border:1px solid var(--dsw-alias-border-l3); }
      [data-live-skin-panel] .ls-table { display:flex; flex-direction:column; border:1px solid var(--dsw-alias-border-l1); border-radius:12px;
        background:var(--dsw-alias-bg-layer-1); padding:4px 12px; }
      [data-live-skin-panel] .ls-row { display:grid; grid-template-columns:minmax(120px, 1fr) minmax(160px, 2fr) 72px;
        align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
      [data-live-skin-panel] .ls-row:last-child { border-bottom:none; }
      [data-live-skin-panel] .ls-row-label { display:flex; flex-direction:column; gap:2px; min-width:0; }
      [data-live-skin-panel] .ls-row-name { color:var(--dsw-alias-label-primary); font:var(--dsw-font-xs-strong-13); display:flex; align-items:center; gap:6px; }
      [data-live-skin-panel] .ls-badge { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary);
        border:1px solid var(--dsw-alias-border-l1); border-radius:4px; padding:0 4px; }
      [data-live-skin-panel] .ls-desc { color:var(--dsw-alias-label-tertiary); font:var(--dsw-font-xxxs-11); }
      [data-live-skin-panel] input[type="range"] { width:100%; accent-color:var(--dsw-alias-brand-primary); }
      [data-live-skin-panel] input[type="color"] { width:40px; height:24px; padding:0; border:1px solid var(--dsw-alias-border-l2);
        border-radius:6px; background:none; cursor:pointer; }
      [data-live-skin-panel] select, [data-live-skin-panel] input[type="text"] { width:100%; border:1px solid var(--dsw-alias-border-l2);
        background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); border-radius:8px; padding:4px 8px; font:var(--dsw-font-xs-13); }
      [data-live-skin-panel] .ls-row-value { text-align:right; color:var(--dsw-alias-label-secondary); font:var(--dsw-font-xxs-12); }
      [data-live-skin-panel] .ls-switch { width:40px; height:22px; border-radius:999px; cursor:pointer; position:relative; flex:none;
        border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2); }
      [data-live-skin-panel] .ls-switch[data-on="true"] { background:var(--dsw-alias-button-primary-fill); border-color:transparent; }
      [data-live-skin-panel] .ls-knob { position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%;
        background:#fff; transition:left var(--ds-transition-duration) var(--ds-ease-in-out); }
      [data-live-skin-panel] .ls-switch[data-on="true"] .ls-knob { left:20px; }
      [data-live-skin-panel] .ls-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
      [data-live-skin-panel] .ls-btn { border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1);
        color:var(--dsw-alias-label-primary); border-radius:9px; padding:5px 14px; cursor:pointer; font:var(--dsw-font-xs-13); }
      [data-live-skin-panel] .ls-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
      [data-live-skin-panel] .ls-btn:disabled { opacity:.45; cursor:default; }
      [data-live-skin-panel] .ls-btn[data-primary="true"] { background:var(--dsw-alias-button-primary-fill); border-color:transparent;
        color:var(--dsw-alias-label-primary-foreground); }
      [data-live-skin-panel] .ls-btn[data-primary="true"]:hover:not(:disabled) { background:var(--dsw-alias-button-primary-hover);
        color:var(--dsw-alias-label-primary-foreground); }
      [data-live-skin-panel] .ls-btn-mini { padding:1px 8px; font:var(--dsw-font-xxxs-11); border-radius:999px; }
      [data-live-skin-panel] .ls-status { display:flex; flex-wrap:wrap; align-items:center; gap:8px; font:var(--dsw-font-xxs-12);
        color:var(--dsw-alias-label-secondary); }
      [data-live-skin-panel] .ls-dot { width:8px; height:8px; border-radius:50%; background:var(--dsw-alias-state-success-primary); flex:none; }
      [data-live-skin-panel] .ls-dot[data-idle="true"] { background:var(--dsw-alias-label-tertiary); }
      [data-live-skin-panel] .ls-error { color:var(--dsw-alias-state-error-primary); font:var(--dsw-font-xxs-12); }
      [data-live-skin-panel] .ls-diag { border:1px solid var(--dsw-alias-border-l2); border-radius:10px; padding:8px 12px;
        background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-state-warn-label); font:var(--dsw-font-xxs-12); max-height:150px; overflow:auto; }
      [data-live-skin-panel] .ls-empty { color:var(--dsw-alias-label-tertiary); font:var(--dsw-font-xs-13); padding:12px 0; }
      [data-live-skin-panel] .ls-warn { border:1px solid var(--dsw-alias-state-warn-primary); border-radius:10px; padding:8px 12px;
        background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-state-warn-label); font:var(--dsw-font-xxs-12); line-height:18px; }
      [data-live-skin-panel] .ls-reset { border:1px solid var(--dsw-alias-border-l2); background:transparent;
        color:var(--dsw-alias-label-tertiary); border-radius:6px; padding:0 5px; cursor:pointer; font-size:11px; line-height:16px; }
      [data-live-skin-panel] .ls-reset:hover { color:var(--dsw-alias-brand-primary); border-color:var(--dsw-alias-brand-primary); }
      [data-live-skin-panel] .ls-io { width:100%; min-height:110px; resize:vertical; box-sizing:border-box;
        border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary);
        border-radius:10px; padding:8px 10px; font-family:var(--ds-font-family-code); font-size:11px; line-height:16px; }
      [data-live-skin-panel] .ls-varrow { display:grid; grid-template-columns:minmax(150px, 1fr) minmax(110px, 1fr); gap:12px;
        padding:4px 0; border-bottom:1px solid var(--dsw-alias-border-l1); align-items:center; }
      [data-live-skin-panel] .ls-varrow:last-child { border-bottom:none; }
      [data-live-skin-panel] .ls-varrow code { font-family:var(--ds-font-family-code); font-size:11px;
        color:var(--dsw-alias-label-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      [data-live-skin-panel] .ls-varname { color:var(--dsw-alias-label-primary); }
    `

    // -----------------------------------------------------------------------
    // UI
    // -----------------------------------------------------------------------

    function Chip(props) {
      return h('button', {
        type: 'button',
        className: 'ls-chip',
        'data-on': props.on ? 'true' : 'false',
        'data-applied': props.applied ? 'true' : 'false',
        onClick: props.onClick
      }, props.children)
    }

    /**
     * 皮肤的档位徽章。文案来自宿主侧的推导（读皮肤自己的 CSS），不是手写声明 ——
     * 用户是拿这句话判断「切到暗色模式会不会变样」的，它不能跟皮肤实际做的事漂移。
     */
    function ModeBadge(props) {
      const appearance = props.appearance
      // 宿主可能比客户端旧（host 半边要重启才更新，客户端由 HMR 现取）。
      // 那种情况下目录册里没有 appearance —— 什么都不标，而不是标一个会误导人的
      // 「档位未知」：那个词是留给「推导不出来」的，不是留给「宿主太旧」的。
      if (appearance === undefined || appearance === null) return null
      if (appearance.light === null || appearance.dark === null) {
        return h('span', { className: 'ls-mode', 'data-mode': 'unknown' }, '档位未知')
      }
      if (appearance.followsSystem) {
        return h('span', {
          className: 'ls-mode',
          'data-mode': 'both',
          title: '亮色模式下是亮色外观，暗色模式下是暗色外观'
        }, '亮 / 暗 跟随系统')
      }
      const only = appearance.light
      return h('span', {
        className: 'ls-mode',
        'data-mode': only,
        title: '这一支两档都用同一套观感，不随系统切换'
      }, only === 'dark' ? '仅暗色观感' : '仅亮色观感')
    }

    function ParamRow(props) {
      const { param, value, onChange, onReset } = props
      const dirty = value !== param.default
      let control = null
      let readout = ''

      if (param.type === 'number') {
        control = h('input', {
          type: 'range',
          min: param.min,
          max: param.max,
          step: param.step,
          value: value,
          onChange: (event) => onChange(Number(event.target.value))
        })
        readout = `${String(value)}${param.unit ?? ''}`
      } else if (param.type === 'boolean') {
        control = h('button', {
          type: 'button',
          className: 'ls-switch',
          'data-on': value ? 'true' : 'false',
          role: 'switch',
          'aria-checked': value,
          'aria-label': param.label,
          onClick: () => onChange(!value)
        }, h('span', { className: 'ls-knob' }))
        readout = value ? '开' : '关'
      } else if (param.type === 'color') {
        control = h('input', {
          type: 'color',
          value: value,
          onChange: (event) => onChange(event.target.value),
          'aria-label': param.label
        })
        readout = value
      } else if (param.type === 'enum') {
        control = h('select', {
          value: value,
          onChange: (event) => onChange(event.target.value),
          'aria-label': param.label
        }, param.options.map((option) => h('option', { key: option.value, value: option.value }, option.label)))
        readout = ''
      } else {
        control = h('input', {
          type: 'text',
          value: value,
          onChange: (event) => onChange(event.target.value),
          'aria-label': param.label
        })
        readout = ''
      }

      return h('div', { className: 'ls-row' },
        h('div', { className: 'ls-row-label' },
          h('span', { className: 'ls-row-name' },
            param.label,
            param.inherited === true ? h('span', { className: 'ls-badge' }, '大类') : null,
            dirty
              ? h('button', {
                type: 'button',
                className: 'ls-reset',
                title: `恢复默认（${String(param.default)}${param.unit ?? ''}）`,
                'aria-label': `${param.label} 恢复默认`,
                onClick: onReset
              }, '↺')
              : null),
          param.description.length > 0 ? h('span', { className: 'ls-desc' }, param.description) : null),
        control,
        h('span', { className: 'ls-row-value' }, readout))
    }

    function LiveSkinSection() {
      const [catalog, setCatalog] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [familyId, setFamilyId] = React.useState(null)
      const [variantId, setVariantId] = React.useState(null)
      const [values, setValues] = React.useState({})
      const [appliedKey, setAppliedKey] = React.useState(null)
      const [conflict, setConflict] = React.useState(null)
      const [dirty, setDirty] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [showIo, setShowIo] = React.useState(false)
      const [showVars, setShowVars] = React.useState(false)
      const [ioText, setIoText] = React.useState('')

      const stateRef = React.useRef({ active: null, values: {}, presets: {} })

      const family = catalog === null ? null : catalog.families.find((entry) => entry.id === familyId) ?? null
      const variant = family === null ? null : family.variants.find((entry) => entry.id === variantId) ?? null

      /** 选中一套皮肤：读它的取值，取出样式，立刻画上去（这就是试穿）。 */
      const select = React.useCallback(async (famId, varId, nextValues) => {
        const fam = catalog === null ? null : catalog.families.find((entry) => entry.id === famId)
        const vari = fam === undefined || fam === null ? null : fam.variants.find((entry) => entry.id === varId)
        if (vari == null) return
        const key = skinKey(famId, varId)
        const base = nextValues ?? stateRef.current.values[key] ?? vari.defaults
        const merged = { ...vari.defaults, ...base }
        setFamilyId(famId)
        setVariantId(varId)
        setValues(merged)
        try {
          const css = await fetchSkinCss(famId, varId)
          runtime.paint(key, vari.params, merged, css)
          setDirty(key !== runtime.appliedKey)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }, [catalog])

      // 每次挂载都重新解析一次：面板关了会被卸载，再打开是全新实例。
      // 若在这里复用「插件启动那一刻」的快照，本次会话里刚应用过的皮肤就看不到，
      // 要刷新页面才对 —— 那正是之前的表现。
      // 已保存的皮肤在 apply() 阶段就画到 DOM 上了，这里解析完不重画 ——
      // 否则「试穿」会把已应用的皮肤顶掉。
      React.useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const snapshot = await resolveActive()
            if (!alive) return
            setCatalog(snapshot.catalog)
            // 与皮肤中心共存提示：它启用皮肤时会在 html 上盖 data-dsh-skin，
            // 两套皮肤同时生效会互相叠加。
            setConflict(document.documentElement.dataset.dshSkin ?? null)
            stateRef.current = {
              active: snapshot.state.state.active,
              values: snapshot.state.resolved ?? {},
              presets: snapshot.state.state.presets ?? {}
            }
            if (snapshot.familyId === null) return
            setFamilyId(snapshot.familyId)
            setVariantId(snapshot.variantId)
            setValues(snapshot.values)
            setAppliedKey(snapshot.active)
            setDirty(false)
          } catch (cause) {
            if (alive) setError(cause instanceof Error ? cause.message : String(cause))
          }
        })()
        return () => { alive = false }
      }, [])

      // 关闭设置面板：丢掉未提交的试穿，回到已提交的那一份
      React.useEffect(() => () => { runtime.restore() }, [])

      const changeParam = React.useCallback((key, value) => {
        setValues((previous) => {
          const next = { ...previous, [key]: value }
          if (variant !== null) runtime.preview(variant.params, next)
          return next
        })
        setDirty(true)
      }, [variant])

      const applyPreset = React.useCallback((preset) => {
        if (variant === null) return
        setValues((previous) => {
          const next = { ...previous, ...preset.values }
          runtime.preview(variant.params, next)
          return next
        })
        setDirty(true)
      }, [variant])

      const commit = React.useCallback(async () => {
        if (variant === null || family === null) return
        setBusy(true)
        setError('')
        try {
          const key = skinKey(family.id, variant.id)
          const response = await apiPost('/state', { active: key, skin: key, values })
          stateRef.current.values[key] = response.state.values[key]
          const css = await fetchSkinCss(family.id, variant.id)
          runtime.commit(key, variant.params, values, css)
          runtime.paint(key, variant.params, values, css)
          setAppliedKey(key)
          setDirty(false)
          setNotice(`已应用 ${variant.name}`)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setBusy(false)
        }
      }, [family, variant, values])

      const resetDefaults = React.useCallback(() => {
        if (variant === null) return
        setValues({ ...variant.defaults })
        runtime.preview(variant.params, variant.defaults)
        setDirty(true)
      }, [variant])

      /** 导出：把当前取值写成一段可备份 / 可分享的 JSON。 */
      const exportConfig = React.useCallback(() => {
        if (family === null || variant === null) return
        setIoText(JSON.stringify({
          skin: skinKey(family.id, variant.id),
          family: family.id,
          variant: variant.id,
          values
        }, null, 2))
        setError('')
        setNotice('已生成配置 JSON：复制走就是备份，粘给别人就是分享')
      }, [family, variant, values])

      /** 导入：只认当前小类声明过的参数，值按声明的域夹取，未声明的忽略掉。 */
      const importConfig = React.useCallback(() => {
        if (variant === null) return
        let parsed
        try {
          parsed = JSON.parse(ioText)
        } catch (cause) {
          setError(`JSON 解析失败：${cause instanceof Error ? cause.message : String(cause)}`)
          return
        }
        const incoming = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.values !== undefined
          ? parsed.values
          : parsed
        if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
          setError('导入内容必须是一个对象，或一个带 values 字段的配置对象')
          return
        }
        const next = { ...values }
        const ignored = []
        for (const [key, raw] of Object.entries(incoming)) {
          const param = variant.params.find((entry) => entry.key === key)
          if (param === undefined) {
            ignored.push(key)
            continue
          }
          next[key] = coerceParamValue(param, raw)
        }
        setValues(next)
        runtime.preview(variant.params, next)
        setDirty(true)
        setError('')
        setNotice(ignored.length > 0
          ? `已套用；忽略了当前小类没有的参数：${ignored.join('、')}`
          : '已套用导入的配置（还没落盘，点「应用」保存）')
      }, [variant, values, ioText])

      const deactivate = React.useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          await apiPost('/state', { active: null })
          stateRef.current.active = null
          runtime.appliedKey = null
          runtime.clear()
          setAppliedKey(null)
          setDirty(false)
          setNotice('已停用，界面回到官方外观')
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setBusy(false)
        }
      }, [])

      if (error.length > 0 && catalog === null) {
        return h('div', { 'data-live-skin-panel': '' },
          h('div', { className: 'ls-title' }, 'LiveSkin'),
          h('div', { className: 'ls-error' }, error),
          h('div', { className: 'ls-muted' }, '确认 dsh-live-skin 插件已在宿主侧挂载（GET /api/live-skin/v1/health）。'))
      }
      if (catalog === null) {
        return h('div', { 'data-live-skin-panel': '' }, h('div', { className: 'ls-empty' }, '正在读取皮肤目录…'))
      }
      if (catalog.families.length === 0) {
        return h('div', { 'data-live-skin-panel': '' },
          h('div', { className: 'ls-title' }, 'LiveSkin'),
          h('div', { className: 'ls-empty' }, '没有可用皮肤。把皮肤目录放进 $DSH_HOME/live-skin/skins/<familyId>/<variantId>/ 即可被收录。'),
          catalog.diagnostics.length > 0 ? h('div', { className: 'ls-diag' }, catalog.diagnostics.join('\n')) : null)
      }

      const groups = []
      if (variant !== null) {
        const byGroup = new Map()
        for (const param of variant.params) {
          const group = param.group.length > 0 ? param.group : '参数'
          if (!byGroup.has(group)) byGroup.set(group, [])
          byGroup.get(group).push(param)
        }
        for (const [name, params] of byGroup) groups.push({ name, params })
      }

      const currentKey = family === null || variant === null ? null : skinKey(family.id, variant.id)
      const isApplied = currentKey !== null && currentKey === appliedKey

      // 「正在使用的」与「正在查看的」不是一回事：浏览别的皮肤时，状态栏和卡片仍要能
      // 指明哪一套在生效，并给一个一键回到它的入口。
      let appliedFamily = null
      let appliedVariant = null
      if (appliedKey !== null) {
        for (const entry of catalog.families) {
          const hit = entry.variants.find((item) => skinKey(entry.id, item.id) === appliedKey)
          if (hit !== undefined) { appliedFamily = entry; appliedVariant = hit; break }
        }
      }
      const viewingOther = appliedKey !== null && currentKey !== appliedKey

      // 按宿主给的分类顺序分行；顺序里没有的分类（目录册比宿主新时可能出现）
      // 追加在后面，不丢家族。
      // 宿主可能比客户端旧（宿主半边要重启才更新，客户端由 HMR 现取），
      // 那时目录册里还没有 categories/category —— 退回「一排全部家族」，
      // 而不是渲染出一行没有标签、装着所有家族的东西。
      const hasCategories = Array.isArray(catalog.categories) && catalog.categories.length > 0
      // 旧宿主只给分类名（字符串），新宿主给 { name, basis } —— 两种都吃。
      const categoryOrder = hasCategories
        ? catalog.categories.map((entry) => (typeof entry === 'string' ? { name: entry, basis: '' } : entry))
        : [{ name: '', basis: '' }]
      const categoryRows = []
      for (const entry of categoryOrder) {
        const families = catalog.families.filter((item) => item.category === entry.name)
        if (families.length > 0) categoryRows.push({ name: entry.name, basis: entry.basis, families })
      }
      for (const entry of catalog.families) {
        if (categoryOrder.some((item) => item.name === entry.category)) continue
        const row = categoryRows.find((item) => item.name === entry.category)
        if (row === undefined) categoryRows.push({ name: entry.category, basis: '', families: [entry] })
        else row.families.push(entry)
      }
      // 每个家族的分类都取不到时（旧宿主），就是上面那个单行 `''` —— 不显示标签。

      // 这一份就是运行时此刻写到 <html> 上的全部变量 —— 与 runtime.writeVars
      // 走同一个 paramVars，所以面板里看到的就是 DOM 里的。
      const varTable = {}
      if (variant !== null) {
        for (const param of variant.params) {
          for (const [name, literal] of paramVars(param, values[param.key])) varTable[name] = literal
        }
      }
      const varNames = Object.keys(varTable).sort()

      return h('div', { 'data-live-skin-panel': '' },
        h('div', { className: 'ls-head' },
          h('span', { className: 'ls-title' },
            catalog.version === undefined || catalog.version === null ? 'LiveSkin' : `LiveSkin ${String(catalog.version)}`),
          h('span', { className: 'ls-muted' },
            catalog.families.length + ' 个皮肤家族 · ' + catalog.families.reduce((sum, entry) => sum + entry.variants.length, 0) + ' 套皮肤')),

        h('div', { className: 'ls-status' },
          h('span', { className: 'ls-dot', 'data-idle': appliedKey === null ? 'true' : 'false' }),
          h('span', null, appliedVariant === null
            ? '当前：官方外观（未启用任何皮肤）'
            : `当前生效：${appliedFamily.name} · ${appliedVariant.name}`),
          appliedVariant === null ? null : h(ModeBadge, { appearance: appliedVariant.appearance }),
          dirty ? h('span', { className: 'ls-muted' }, '· 预览中（未应用）') : null,
          viewingOther
            ? h('button', {
              type: 'button',
              className: 'ls-btn ls-btn-mini',
              title: '把编辑区切回正在生效的那一套',
              onClick: () => { void select(appliedFamily.id, appliedVariant.id) }
            }, '回到当前')
            : null),

        conflict !== null && conflict !== undefined
          ? h('div', { className: 'ls-warn' },
            `皮肤中心当前也在生效（data-dsh-skin="${String(conflict)}"），两套皮肤会互相叠加。`,
            h('br'),
            '建议先到「设置 → 皮肤中心」切回「官方默认」，再启用 LiveSkin。')
          : null,

        // 大类：按分类分成几行。分类与行序来自宿主（`categories`），
        // 面板不自己排 —— 那是数据不是显示。
        h('div', { className: 'ls-group' },
          h('span', { className: 'ls-group-label' }, '皮肤家族'),
          h('div', {
            className: 'ls-cat-rows',
            'data-plain': categoryRows.length === 1 && categoryRows[0].name === '' ? 'true' : 'false'
          },
            categoryRows.map((row) => h('div', { key: row.name, className: 'ls-cat-row', 'data-plain': row.name === '' ? 'true' : 'false' },
              row.name === '' ? null : h('span', { className: 'ls-cat-label' },
                h('span', null, row.name),
                // 排序依据与分类名一样来自宿主：它是数据，不是面板文案。
                typeof row.basis === 'string' && row.basis.length > 0
                  ? h('span', { className: 'ls-cat-basis' }, row.basis)
                  : null),
              h('div', { className: 'ls-chips' }, row.families.map((entry) => h(Chip, {
                key: entry.id,
                on: entry.id === familyId,
                applied: appliedFamily !== null && entry.id === appliedFamily.id,
                onClick: () => {
                  const first = entry.variants[0]
                  if (first !== undefined) void select(entry.id, first.id)
                }
              }, entry.name))))
            ))),

        family !== null && family.description.length > 0
          ? h('div', { className: 'ls-muted' }, family.description)
          : null,

        // 小类
        family !== null
          ? h('div', { className: 'ls-group' },
            h('span', { className: 'ls-group-label' }, '皮肤'),
            h('div', { className: 'ls-cards' }, family.variants.map((entry) => h('button', {
              key: entry.id,
              type: 'button',
              className: 'ls-card',
              'data-on': entry.id === variantId ? 'true' : 'false',
              'data-applied': appliedKey === skinKey(family.id, entry.id) ? 'true' : 'false',
              onClick: () => { void select(family.id, entry.id) }
            },
            h('span', { className: 'ls-card-name' },
              entry.accent.length > 0 ? h('span', { className: 'ls-swatch', style: { background: entry.accent } }) : null,
              entry.name,
              appliedKey === skinKey(family.id, entry.id)
                ? h('span', { className: 'ls-now' }, '使用中')
                : null),
            entry.description.length > 0 ? h('span', { className: 'ls-desc' }, entry.description) : null,
            h('span', { className: 'ls-card-foot' },
              h(ModeBadge, { appearance: entry.appearance }),
              h('span', { className: 'ls-muted' }, `${String(entry.params.length)} 项可调`))))))
          : null,

        // 预设
        variant !== null && variant.presets.length > 0
          ? h('div', { className: 'ls-group' },
            h('span', { className: 'ls-group-label' }, '预设档位'),
            h('div', { className: 'ls-chips' }, variant.presets.map((preset) => h(Chip, {
              key: preset.id,
              on: false,
              onClick: () => applyPreset(preset)
            }, preset.name))))
          : null,

        // 参数
        variant !== null
          ? h('div', { className: 'ls-group' },
            groups.map((group) => h('div', { key: group.name, className: 'ls-group' },
              h('span', { className: 'ls-group-label' }, group.name),
              h('div', { className: 'ls-table' }, group.params.map((param) => h(ParamRow, {
                key: param.key,
                param,
                value: values[param.key],
                onChange: (value) => changeParam(param.key, value),
                onReset: () => changeParam(param.key, param.default)
              }))))))
          : null,

        // 动作
        h('div', { className: 'ls-actions' },
          h('button', {
            type: 'button',
            className: 'ls-btn',
            'data-primary': 'true',
            disabled: busy || variant === null || (isApplied && !dirty),
            onClick: () => { void commit() }
          }, isApplied && !dirty ? '已应用' : '应用'),
          h('button', {
            type: 'button',
            className: 'ls-btn',
            disabled: busy || variant === null,
            onClick: resetDefaults
          }, '恢复默认'),
          h('button', {
            type: 'button',
            className: 'ls-btn',
            disabled: busy || appliedKey === null,
            onClick: () => { void deactivate() }
          }, '停用'),
          h('span', { className: 'ls-muted' }, '拖动即时预览，点「应用」才会写进持久化状态')),

        // 工具条：导入导出 + 变量表
        h('div', { className: 'ls-actions' },
          h('button', {
            type: 'button', className: 'ls-btn', disabled: variant === null,
            onClick: () => setShowIo(!showIo)
          }, showIo ? '收起导入 / 导出' : '导入 / 导出'),
          h('button', {
            type: 'button', className: 'ls-btn', disabled: variant === null,
            onClick: () => setShowVars(!showVars)
          }, showVars ? '收起变量表' : `查看 CSS 变量（${String(varNames.length)}）`)),

        showIo
          ? h('div', { className: 'ls-group' },
            h('textarea', {
              className: 'ls-io',
              spellCheck: false,
              'aria-label': '皮肤配置 JSON',
              placeholder: '把配置 JSON 粘到这里，再点「从文本导入」',
              value: ioText,
              onChange: (event) => setIoText(event.target.value)
            }),
            h('div', { className: 'ls-actions' },
              h('button', {
                type: 'button', className: 'ls-btn', disabled: variant === null, onClick: exportConfig
              }, '把当前取值导出到上面'),
              h('button', {
                type: 'button', className: 'ls-btn',
                disabled: variant === null || ioText.trim().length === 0,
                onClick: importConfig
              }, '从文本导入')))
          : null,

        showVars
          ? h('div', { className: 'ls-group' },
            h('span', { className: 'ls-group-label' }, '运行时写到 <html> 上的全部内容'),
            h('div', { className: 'ls-table' },
              h('div', { key: 'attr', className: 'ls-varrow' },
                h('code', { className: 'ls-varname' }, 'data-live-skin'),
                h('code', null, currentKey ?? '（未生效）')),
              varNames.map((name) => h('div', { key: name, className: 'ls-varrow' },
                h('code', { className: 'ls-varname' }, name),
                h('code', null, varTable[name])))))
          : null,

        error.length > 0 ? h('div', { className: 'ls-error' }, error) : null,
        notice.length > 0 && error.length === 0 ? h('div', { className: 'ls-muted' }, notice) : null,

        catalog.diagnostics.length > 0
          ? h('details', { className: 'ls-group' },
            h('summary', { className: 'ls-muted' }, `目录诊断（${String(catalog.diagnostics.length)}）`),
            h('div', { className: 'ls-diag' }, catalog.diagnostics.join('\n')))
          : null)
    }

    // -----------------------------------------------------------------------
    // 插件体
    // -----------------------------------------------------------------------

    const inject = ['slots']

    function apply(ctx) {
      if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css=${JSON.stringify(`${STYLE_TAG_ID}.ui`)}]`) === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-live-skin'
        tag.dataset.pluginCss = `${STYLE_TAG_ID}.ui`
        tag.textContent = UI_CSS
        document.head.appendChild(tag)
      }

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'live-skin',
        order: 200,
        label: () => 'LiveSkin'
      }, LiveSkinSection))

      // 页面一加载就把已保存的皮肤画上去 —— 「应用」跨刷新存活靠的就是这一步。
      ctx.effect(() => {
        void bootActiveSkin()
        return () => {
          bootCancelled = true
          runtime.dispose()
        }
      }, 'live-skin: runtime boot + teardown')
    }

    exports.NS = NS
    exports.apply = apply
    exports.inject = inject
    exports.runtime = runtime
    exports.panelCss = UI_CSS
    exports.paramVars = paramVars
    exports.coerceParamValue = coerceParamValue
    return module.exports
  }
})
