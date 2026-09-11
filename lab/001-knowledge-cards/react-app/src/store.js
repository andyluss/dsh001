// 数据层：localStorage 读写、树工具、迁移、统计与筛选。
// 全部为纯函数（不依赖 DOM），便于单元测试与复用。

export const CK = 'kcards.v1';
export const CATK = 'kcats.v1';
export const TAGK = 'ktags.v1';

export function uid(prefix = 'n') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- 树工具 ----------
export function findNode(nodes, id) {
  if (!id) return null;
  for (const n of nodes) {
    if (n.id === id) return n;
    const r = findNode(n.children || [], id);
    if (r) return r;
  }
  return null;
}

export function findPath(nodes, id, path = []) {
  for (const n of nodes) {
    const p = path.concat([n]);
    if (n.id === id) return p;
    const r = findPath(n.children || [], id, p);
    if (r) return r;
  }
  return null;
}

export function flatten(nodes, depth = 0, out = []) {
  nodes.forEach((n) => {
    out.push({ node: n, depth });
    flatten(n.children || [], depth + 1, out);
  });
  return out;
}

export function subtreeIds(node) {
  const set = new Set();
  (function walk(n) {
    set.add(n.id);
    (n.children || []).forEach(walk);
  })(node);
  return set;
}

// ---------- 不可变树操作 ----------
export function treeAdd(nodes, parentId, node) {
  if (!parentId) return [...nodes, node];
  return nodes.map((n) =>
    n.id === parentId
      ? { ...n, children: [...(n.children || []), node] }
      : n.children && n.children.length
        ? { ...n, children: treeAdd(n.children, parentId, node) }
        : n,
  );
}

export function treeRename(nodes, id, name) {
  return nodes.map((n) =>
    n.id === id
      ? { ...n, name }
      : n.children && n.children.length
        ? { ...n, children: treeRename(n.children, id, name) }
        : n,
  );
}

export function treeDelete(nodes, id, removed = []) {
  const next = [];
  for (const n of nodes) {
    if (n.id === id) {
      removed.push(n);
      continue;
    }
    next.push(
      n.children && n.children.length
        ? { ...n, children: treeDelete(n.children, id, removed) }
        : n,
    );
  }
  return next;
}

// 在 targetId 的前/后插入兄弟节点（不可变）
export function treeInsertSibling(nodes, targetId, node, before) {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === targetId) {
      const next = [...nodes];
      next.splice(before ? i : i + 1, 0, node);
      return next;
    }
    if (nodes[i].children && nodes[i].children.length) {
      const kids = treeInsertSibling(nodes[i].children, targetId, node, before);
      if (kids) {
        return nodes.map((n, idx) => (idx === i ? { ...n, children: kids } : n));
      }
    }
  }
  return null;
}

// 拖拽移动节点：pos = 'before' | 'after' | 'child'
// 非法情况（拖到自身 / 自身子树）返回 null
export function treeMove(nodes, dragId, targetId, pos) {
  if (dragId === targetId) return null;
  const dragNode = findNode(nodes, dragId);
  const targetNode = findNode(nodes, targetId);
  if (!dragNode || !targetNode) return null;
  if (subtreeIds(dragNode).has(targetId)) return null; // 不能拖入自己的子树
  const removed = [];
  const without = treeDelete(nodes, dragId, removed);
  if (!removed.length) return null;
  const node = cloneNode(removed[0]);
  if (pos === 'child') return treeAdd(without, targetId, node);
  return treeInsertSibling(without, targetId, node, pos === 'before');
}

export function cloneNode(n) {
  return { id: n.id, name: n.name, children: (n.children || []).map(cloneNode) };
}

export function mergeTrees(a, b) {
  b.forEach((nb) => {
    const ex = a.find((na) => na.id === nb.id);
    if (ex) ex.children = mergeTrees(ex.children || [], nb.children || []);
    else a.push(cloneNode(nb));
  });
  return a;
}

// ---------- 存储 ----------
function read(k, fb) {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return Array.isArray(v) ? v : fb;
  } catch {
    return fb;
  }
}

export function persistState({ cards, categories, tags }) {
  localStorage.setItem(CK, JSON.stringify(cards));
  localStorage.setItem(CATK, JSON.stringify(categories));
  localStorage.setItem(TAGK, JSON.stringify(tags));
}

// 旧版卡片的字符串标签 -> 标签树节点 id
export function migrate(cards, tags) {
  const tagByName = {};
  flatten(tags, 0).forEach((o) => { tagByName[o.node.name] = o.node.id; });
  const newTags = [...tags];
  const newCards = cards.map((c) => {
    if (!c || typeof c !== 'object') return c;
    const nc = {
      ...c,
      front: c.front ?? '',
      back: c.back ?? '',
      categoryId: c.categoryId ?? null,
      pinned: !!c.pinned,
      reviews: c.reviews && typeof c.reviews === 'object' ? { ...c.reviews } : null,
      tags: Array.isArray(c.tags) ? [...c.tags] : [],
    };
    if (nc.tags.length && typeof nc.tags[0] === 'string') {
      const allIds = nc.tags.every((t) => findNode(newTags, t));
      if (allIds) {
        nc.tags = nc.tags.filter((t) => findNode(newTags, t));
      } else {
        nc.tags = nc.tags.map((name) => {
          if (tagByName[name]) return tagByName[name];
          const n = { id: uid('t'), name, children: [] };
          newTags.push(n);
          tagByName[name] = n.id;
          return n.id;
        });
      }
    }
    return nc;
  });
  return { cards: newCards, tags: newTags };
}

export function expandAll(nodes) {
  const exp = {};
  (function walk(ns) {
    ns.forEach((n) => {
      if (n.children && n.children.length) {
        exp[n.id] = true;
        walk(n.children);
      }
    });
  })(nodes);
  return exp;
}

export function loadState() {
  let cards = read(CK, []);
  let categories = read(CATK, []);
  let tags = read(TAGK, []);
  const m = migrate(cards, tags);
  cards = m.cards;
  tags = m.tags;
  if (!cards.length && !categories.length && !tags.length) {
    const s = seed();
    cards = s.cards;
    categories = s.categories;
    tags = s.tags;
  }
  persistState({ cards, categories, tags });
  return { cards, categories, tags };
}

function seed() {
  const now = new Date().toISOString();
  const categories = [
    { id: uid('k'), name: '编程', children: [
      { id: uid('k'), name: '前端', children: [] },
      { id: uid('k'), name: '后端', children: [] } ] },
    { id: uid('k'), name: '科学', children: [
      { id: uid('k'), name: '物理', children: [] } ] },
    { id: uid('k'), name: '生活', children: [] },
  ];
  const tags = [
    { id: uid('t'), name: '使用说明', children: [] },
    { id: uid('t'), name: '面试', children: [] },
    { id: uid('t'), name: '基础', children: [] },
    { id: uid('t'), name: '专题', children: [
      { id: uid('t'), name: 'JS', children: [] } ] },
  ];
  const byName = (nodes, name) => {
    for (const n of nodes) {
      if (n.name === name) return n;
      const r = byName(n.children || [], name);
      if (r) return r;
    }
    return null;
  };
  const cards = [
    { id: uid('c'), front: '点击卡片可翻转查看背面', back: '点卡片右下角的 ✏️ 可编辑。左侧是分类与标签树：点节点筛选，点箭头展开/收起。', categoryId: null, tags: [byName(tags, '使用说明').id], createdAt: now, updatedAt: now },
    { id: uid('c'), front: '什么是闭包？', back: '闭包是函数与其词法作用域的组合，使内层函数可以访问外层函数中的变量，即使外层函数已经返回。', categoryId: byName(categories, '前端').id, tags: [byName(tags, 'JS').id, byName(tags, '面试').id], createdAt: now, updatedAt: now },
    { id: uid('c'), front: 'E = mc²', back: '质能等价公式：能量等于质量乘以光速的平方，由爱因斯坦在 1905 年提出。', categoryId: byName(categories, '物理').id, tags: [byName(tags, '基础').id], createdAt: now, updatedAt: now },
  ];
  return { cards, categories, tags };
}

// ---------- 统计与筛选 ----------
export function buildCatCounts(cards, categories) {
  const m = {};
  cards.forEach((c) => {
    if (!c.categoryId) return;
    const path = findPath(categories, c.categoryId);
    if (!path) return;
    path.forEach((n) => { m[n.id] = (m[n.id] || 0) + 1; });
  });
  return m;
}

export function buildTagCounts(cards, tags) {
  const m = {};
  cards.forEach((c) => {
    (c.tags || []).forEach((tid) => {
      const path = findPath(tags, tid);
      if (!path) return;
      path.forEach((n) => { m[n.id] = (m[n.id] || 0) + 1; });
    });
  });
  return m;
}

export function cardMatches(card, { query = '', catId = null, tagId = null }, categories, tags) {
  const q = query.trim().toLowerCase();
  if (q) {
    const tagNames = (card.tags || [])
      .map((tid) => { const n = findNode(tags, tid); return n ? n.name : ''; })
      .join(' ');
    const cat = card.categoryId ? findNode(categories, card.categoryId) : null;
    const hay = (card.front + ' ' + card.back + ' ' + tagNames + ' ' + (cat ? cat.name : '')).toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (catId) {
    const node = findNode(categories, catId);
    if (!node || !subtreeIds(node).has(card.categoryId)) return false;
  }
  if (tagId) {
    const tnode = findNode(tags, tagId);
    if (!tnode) return false;
    const ids = subtreeIds(tnode);
    if (!(card.tags || []).some((tid) => ids.has(tid))) return false;
  }
  return true;
}

// ---------- 排序 ----------
// key: 'default' | 'created' | 'updated' | 'title' | 'titleDesc'
// 置顶卡片始终排在最前
export function sortCards(cards, key) {
  const arr = [...cards];
  arr.sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    switch (key) {
      case 'created': return (b.createdAt || '').localeCompare(a.createdAt || '');
      case 'updated': return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      case 'title': return (a.front || '').localeCompare(b.front || '', 'zh');
      case 'titleDesc': return (b.front || '').localeCompare(a.front || '', 'zh');
      default: return 0; // 保持数组顺序（新建在前）
    }
  });
  return arr;
}

// ---------- 复习（SM-2 简化版） ----------
export const DAY = 86400000;

// 未复习过或已到期的卡片需要复习
export function isDue(card, now = Date.now()) {
  return !card.reviews || !card.reviews.due || card.reviews.due <= now;
}

// quality: 0=忘记, 3=模糊, 4=认识, 5=简单
export function sm2(quality, reviews = { ease: 2.5, interval: 0, reps: 0, lapses: 0 }) {
  const { ease, interval, reps, lapses } = reviews;
  const now = Date.now();
  let e = ease, iv = interval, rp = reps, lp = lapses;
  if (quality < 3) {
    rp = 0;
    iv = 0;
    lp += 1;
    e = Math.max(1.3, e - 0.2);
  } else {
    rp += 1;
    if (rp === 1) iv = 1;
    else if (rp === 2) iv = 6;
    else iv = Math.round(iv * e);
    e = Math.max(1.3, e + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  }
  return { ease: e, interval: iv, reps: rp, lapses: lp, due: now + iv * DAY, lastReview: now };
}
