import { describe, it, expect } from 'vitest';
import {
  findNode, flatten, subtreeIds,
  treeAdd, treeRename, treeDelete, treeInsertSibling, treeMove, mergeTrees,
  migrate, cardMatches, buildCatCounts, buildTagCounts, sortCards, isDue, sm2, DAY,
} from './store';

const catTree = [
  { id: 'a', name: 'A', children: [
    { id: 'b', name: 'B', children: [
      { id: 'c', name: 'C', children: [] },
    ] },
  ] },
  { id: 'd', name: 'D', children: [] },
];

const tagTree = [
  { id: 't1', name: 'T1', children: [
    { id: 't2', name: 'T2', children: [] },
  ] },
];

describe('树工具', () => {
  it('findNode 深查找', () => {
    expect(findNode(catTree, 'c').name).toBe('C');
    expect(findNode(catTree, 'nope')).toBeNull();
  });

  it('flatten 带深度', () => {
    const flat = flatten(catTree, 0);
    expect(flat.map((o) => `${o.depth}:${o.node.id}`)).toEqual(['0:a', '1:b', '2:c', '0:d']);
  });

  it('subtreeIds 收集子树', () => {
    expect([...subtreeIds(findNode(catTree, 'a'))].sort()).toEqual(['a', 'b', 'c']);
    expect([...subtreeIds(findNode(catTree, 'd'))]).toEqual(['d']);
  });

  it('treeAdd 不可变地添加根/子节点', () => {
    const addedChild = treeAdd(catTree, 'b', { id: 'x', name: 'X', children: [] });
    expect(addedChild).not.toBe(catTree);
    expect(findNode(addedChild, 'x').name).toBe('X');
    expect(findNode(catTree, 'x')).toBeNull(); // 原树不变

    const addedRoot = treeAdd(catTree, null, { id: 'y', name: 'Y', children: [] });
    expect(addedRoot.length).toBe(catTree.length + 1);
    expect(addedRoot[addedRoot.length - 1].id).toBe('y');
  });

  it('treeRename 不可变地重命名', () => {
    const renamed = treeRename(catTree, 'b', 'B2');
    expect(findNode(renamed, 'b').name).toBe('B2');
    expect(findNode(catTree, 'b').name).toBe('B');
  });

  it('treeDelete 删除子树并收集被删节点', () => {
    const removed = [];
    const next = treeDelete(catTree, 'a', removed);
    expect(next.length).toBe(1);
    expect(next[0].id).toBe('d');
    expect(removed.length).toBe(1);
    expect(removed[0].id).toBe('a');

    const removedDeep = [];
    const nextDeep = treeDelete(catTree, 'c', removedDeep);
    expect(findNode(nextDeep, 'b').children.length).toBe(0);
  });

  it('mergeTrees 按 id 合并', () => {
    const a = [{ id: 'a', name: 'A', children: [] }];
    const b = [
      { id: 'a', name: 'A(新)', children: [{ id: 'a1', name: 'A1', children: [] }] },
      { id: 'z', name: 'Z', children: [] },
    ];
    mergeTrees(a, b);
    expect(a.length).toBe(2);
    expect(a[0].name).toBe('A'); // 保留现有名称
    expect(a[0].children[0].id).toBe('a1'); // 子节点合并进来
    expect(a[1].id).toBe('z');
  });
});

describe('树拖拽 treeMove', () => {
  const tree = () => [
    { id: 'a', name: 'A', children: [
      { id: 'b', name: 'B', children: [
        { id: 'c', name: 'C', children: [] },
      ] },
    ] },
    { id: 'd', name: 'D', children: [] },
  ];

  it('拖为子节点', () => {
    const next = treeMove(tree(), 'd', 'b', 'child');
    expect(next[0].children[0].children.map((n) => n.id)).toEqual(['c', 'd']);
    expect(next.length).toBe(1); // d 不再是根
  });

  it('拖到目标之前/之后（兄弟位）', () => {
    const before = treeMove(tree(), 'd', 'a', 'before');
    expect(before.map((n) => n.id)).toEqual(['d', 'a']);
    const after = treeMove(tree(), 'd', 'a', 'after');
    expect(after.map((n) => n.id)).toEqual(['a', 'd']);
  });

  it('深层节点移动到兄弟位', () => {
    const next = treeMove(tree(), 'c', 'd', 'after');
    expect(next[0].children[0].children.length).toBe(0);
    expect(next.map((n) => n.id)).toEqual(['a', 'd', 'c']);
  });

  it('非法：拖到自身或自身子树返回 null', () => {
    expect(treeMove(tree(), 'a', 'a', 'child')).toBeNull();
    expect(treeMove(tree(), 'a', 'c', 'child')).toBeNull(); // c 在 a 的子树里
    expect(treeMove(tree(), 'nope', 'a', 'child')).toBeNull();
  });

  it('treeInsertSibling 直接插入', () => {
    const next = treeInsertSibling(tree(), 'b', { id: 'x', name: 'X', children: [] }, false);
    expect(next[0].children.map((n) => n.id)).toEqual(['b', 'x']);
  });
});

describe('migrate 旧数据迁移', () => {
  it('字符串标签 -> 标签树节点 id', () => {
    const { cards, tags } = migrate(
      [{ id: 'c1', front: 'f', back: 'b', tags: ['面试', 'JS'] }],
      [],
    );
    expect(tags.length).toBe(2);
    expect(tags.map((n) => n.name).sort()).toEqual(['JS', '面试']);
    expect(cards[0].tags.length).toBe(2);
    expect(cards[0].tags.every((id) => findNode(tags, id))).toBe(true);
  });

  it('已是 id 的标签保持不变', () => {
    const tags = [{ id: 't9', name: '已有', children: [] }];
    const { cards, tags: tags2 } = migrate(
      [{ id: 'c1', front: 'f', back: 'b', tags: ['t9'] }],
      tags,
    );
    expect(tags2).toHaveLength(1); // 树未被重建
    expect(tags2[0]).toBe(tags[0]); // 节点引用不变
    expect(cards[0].tags).toEqual(['t9']);
  });

  it('同名标签复用已有节点', () => {
    const tags = [{ id: 't1', name: '面试', children: [] }];
    const { cards, tags: tags2 } = migrate(
      [{ id: 'c1', front: 'f', back: 'b', tags: ['面试'] }],
      tags,
    );
    expect(tags2.length).toBe(1);
    expect(cards[0].tags).toEqual(['t1']);
  });
});

describe('统计与筛选', () => {
  const cards = [
    { id: 1, front: '闭包', back: '', categoryId: 'c', tags: ['t2'], createdAt: '', updatedAt: '' },
    { id: 2, front: 'E=mc2', back: '', categoryId: 'd', tags: [], createdAt: '', updatedAt: '' },
  ];

  it('buildCatCounts 沿路径累计', () => {
    const m = buildCatCounts(cards, catTree);
    expect(m.a).toBe(1);
    expect(m.b).toBe(1);
    expect(m.c).toBe(1);
    expect(m.d).toBe(1);
  });

  it('buildTagCounts 沿路径累计', () => {
    const m = buildTagCounts(cards, tagTree);
    expect(m.t1).toBe(1);
    expect(m.t2).toBe(1);
  });

  it('分类筛选包含子孙分类', () => {
    expect(cardMatches(cards[0], { query: '', catId: 'a', tagId: null }, catTree, tagTree)).toBe(true);
    expect(cardMatches(cards[1], { query: '', catId: 'a', tagId: null }, catTree, tagTree)).toBe(false);
  });

  it('标签筛选包含子孙标签', () => {
    expect(cardMatches(cards[0], { query: '', catId: null, tagId: 't1' }, catTree, tagTree)).toBe(true);
    expect(cardMatches(cards[1], { query: '', catId: null, tagId: 't1' }, catTree, tagTree)).toBe(false);
  });

  it('文本搜索覆盖标签名与分类名', () => {
    expect(cardMatches(cards[0], { query: 'T2', catId: null, tagId: null }, catTree, tagTree)).toBe(true);
    expect(cardMatches(cards[1], { query: 'B', catId: null, tagId: null }, catTree, tagTree)).toBe(false);
    expect(cardMatches(cards[1], { query: 'D', catId: null, tagId: null }, catTree, tagTree)).toBe(true);
  });
});

describe('migrate 新字段', () => {
  it('补齐 pinned / reviews 默认值', () => {
    const { cards } = migrate(
      [{ id: 'c1', front: 'f', back: 'b', tags: [] }],
      [],
    );
    expect(cards[0].pinned).toBe(false);
    expect(cards[0].reviews).toBeNull();
  });

  it('保留已有 pinned / reviews', () => {
    const { cards } = migrate(
      [{ id: 'c1', front: 'f', back: 'b', tags: [], pinned: true, reviews: { ease: 2.5, interval: 3, reps: 2, lapses: 0, due: 123, lastReview: 100 } }],
      [],
    );
    expect(cards[0].pinned).toBe(true);
    expect(cards[0].reviews.interval).toBe(3);
  });
});

describe('排序 sortCards', () => {
  const cards = [
    { id: 1, front: 'b卡', pinned: false, createdAt: '2024-01-02', updatedAt: '2024-01-05' },
    { id: 2, front: 'a卡', pinned: true, createdAt: '2024-01-03', updatedAt: '2024-01-01' },
    { id: 3, front: 'c卡', pinned: false, createdAt: '2024-01-01', updatedAt: '2024-01-09' },
  ];

  it('置顶始终在最前', () => {
    const out = sortCards(cards, 'default');
    expect(out[0].id).toBe(2);
  });

  it('按创建时间排序（置顶仍最前）', () => {
    const out = sortCards(cards, 'created');
    expect(out.map((c) => c.id)).toEqual([2, 1, 3]);
  });

  it('按更新时间排序', () => {
    const out = sortCards(cards, 'updated');
    expect(out.map((c) => c.id)).toEqual([2, 3, 1]);
  });

  it('按标题排序', () => {
    const out = sortCards(cards, 'title');
    expect(out.map((c) => c.id)).toEqual([2, 1, 3]);
    const desc = sortCards(cards, 'titleDesc');
    expect(desc.map((c) => c.id)).toEqual([2, 3, 1]);
  });
});

describe('复习调度 sm2 / isDue', () => {
  it('未复习卡片视为到期', () => {
    expect(isDue({ reviews: null })).toBe(true);
    expect(isDue({})).toBe(true);
  });

  it('已到期/未到期判断', () => {
    expect(isDue({ reviews: { due: Date.now() - 1000 } })).toBe(true);
    expect(isDue({ reviews: { due: Date.now() + DAY } })).toBe(false);
  });

  it('第一次答对：间隔 1 天', () => {
    const r = sm2(4);
    expect(r.interval).toBe(1);
    expect(r.reps).toBe(1);
    expect(r.due).toBeGreaterThan(Date.now());
    expect(r.ease).toBeCloseTo(2.5, 5);
  });

  it('第二次答对：间隔 6 天', () => {
    const r = sm2(5, sm2(4));
    expect(r.interval).toBe(6);
  });

  it('后续间隔按难度系数增长', () => {
    const r1 = sm2(4, sm2(4, sm2(4))); // 第三轮: round(6 * 2.5) = 15
    expect(r1.interval).toBe(15);
    const r2 = sm2(5, sm2(4, sm2(4))); // ease 在计算本轮间隔后才更新: round(6 * 2.5) = 15
    expect(r2.interval).toBe(15);
    expect(r2.ease).toBeGreaterThan(r1.ease);
  });

  it('答错重置并降低难度系数', () => {
    const prev = sm2(4, sm2(4));
    const r = sm2(0, prev);
    expect(r.interval).toBe(0);
    expect(r.reps).toBe(0);
    expect(r.lapses).toBe(1);
    expect(r.ease).toBeLessThan(prev.ease);
    expect(r.ease).toBeGreaterThanOrEqual(1.3);
  });
});
