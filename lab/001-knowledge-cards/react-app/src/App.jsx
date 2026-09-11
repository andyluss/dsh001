import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadState, persistState, uid, findNode, subtreeIds, expandAll,
  treeAdd, treeRename, treeDelete, treeMove, mergeTrees, migrate,
  buildCatCounts, buildTagCounts, cardMatches, sortCards, isDue, sm2,
} from './store';
import Sidebar from './components/Sidebar';
import CardGrid from './components/CardGrid';
import FilterBar from './components/FilterBar';
import EditorModal from './components/EditorModal';
import ReviewModal from './components/ReviewModal';

const HISTORY_MAX = 50;

export default function App() {
  // 首次渲染时从 localStorage 载入（含旧数据迁移与种子数据）
  const [initial] = useState(() => {
    const s = loadState();
    return { ...s, expanded: { ...expandAll(s.categories), ...expandAll(s.tags) } };
  });
  const [cards, setCards] = useState(initial.cards);
  const [categories, setCategories] = useState(initial.categories);
  const [tags, setTags] = useState(initial.tags);
  const [expanded, setExpanded] = useState(initial.expanded);
  const [filter, setFilter] = useState({ query: '', catId: null, tagId: null });
  const [editingId, setEditingId] = useState(null); // null=关闭, 'new'=新建, 否则编辑该卡片
  const [sideOpen, setSideOpen] = useState(false);
  const [history, setHistory] = useState([]); // 撤销栈
  const [future, setFuture] = useState([]); // 重做栈
  const [dragging, setDragging] = useState(null); // { kind, id }
  const [review, setReview] = useState(null); // { queue, index, finished, results }
  const [reviewMenu, setReviewMenu] = useState(false);
  const [sortKey, setSortKey] = useState(() => {
    try { return localStorage.getItem('ksort.v1') || 'default'; } catch { return 'default'; }
  });
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('ktheme.v1');
      if (saved) return saved;
      return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch { return 'light'; }
  });
  const fileRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    document.body.classList.toggle('side-open', sideOpen);
  }, [sideOpen]);
  useEffect(() => {
    document.body.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('ktheme.v1', theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem('ksort.v1', sortKey);
  }, [sortKey]);

  // 统一提交：记录历史、更新三个状态并写回 localStorage
  const commit = (next) => {
    const prev = { cards, categories, tags };
    const s = { ...prev, ...next };
    setHistory((h) => [...h.slice(-(HISTORY_MAX - 1)), prev]);
    setFuture([]);
    setCards(s.cards);
    setCategories(s.categories);
    setTags(s.tags);
    persistState(s);
  };
  const applySnapshot = (s) => {
    setCards(s.cards);
    setCategories(s.categories);
    setTags(s.tags);
    persistState(s);
  };
  const undo = () => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setFuture((f) => [...f, { cards, categories, tags }]);
    setHistory((h) => h.slice(0, -1));
    applySnapshot(prev);
  };
  const redo = () => {
    if (!future.length) return;
    const next = future[future.length - 1];
    setHistory((h) => [...h, { cards, categories, tags }]);
    setFuture((f) => f.slice(0, -1));
    applySnapshot(next);
  };

  const catCounts = useMemo(() => buildCatCounts(cards, categories), [cards, categories]);
  const tagCounts = useMemo(() => buildTagCounts(cards, tags), [cards, tags]);
  const dueCount = useMemo(() => cards.filter((c) => isDue(c)).length, [cards]);
  const visibleCards = useMemo(() => {
    const matched = cards.filter((c) => cardMatches(c, filter, categories, tags));
    return sortCards(matched, sortKey);
  }, [cards, filter, categories, tags, sortKey]);
  const editingCard =
    editingId && editingId !== 'new' ? cards.find((c) => c.id === editingId) || null : null;
  const reviewCard = review && !review.finished && review.index < review.queue.length
    ? cards.find((c) => c.id === review.queue[review.index]) || null
    : null;

  // ---------- 卡片 ----------
  const openEditor = (id) => setEditingId(id ?? 'new');
  const closeEditor = () => setEditingId(null);

  const handleSave = (data) => {
    if (!data.front && !data.back) {
      alert('正面或背面至少要填一个');
      return;
    }
    const now = new Date().toISOString();
    if (editingId !== 'new') {
      commit({
        cards: cards.map((c) => (c.id === editingId ? { ...c, ...data, updatedAt: now } : c)),
      });
    } else {
      commit({
        cards: [{ id: uid('c'), ...data, pinned: false, reviews: null, createdAt: now, updatedAt: now }, ...cards],
      });
    }
    closeEditor();
  };

  const handleDeleteCard = () => {
    if (!editingId || editingId === 'new') return;
    if (!confirm('确定删除这张卡片？')) return;
    commit({ cards: cards.filter((c) => c.id !== editingId) });
    closeEditor();
  };

  const handleDuplicate = () => {
    const card = editingCard;
    if (!card) return;
    const now = new Date().toISOString();
    const copy = {
      ...card, id: uid('c'),
      front: card.front, back: card.back, categoryId: card.categoryId, tags: [...card.tags],
      pinned: false, reviews: null, createdAt: now, updatedAt: now,
    };
    commit({ cards: [copy, ...cards] });
    closeEditor();
  };

  const handleTogglePin = (id) => {
    commit({
      cards: cards.map((c) => (c.id === id ? { ...c, pinned: !c.pinned, updatedAt: new Date().toISOString() } : c)),
    });
  };

  // ---------- 复习 ----------
  const startReview = (all) => {
    const queue = cards.filter((c) => all || isDue(c)).map((c) => c.id);
    if (!queue.length) {
      alert(all ? '还没有卡片' : '没有到期的卡片 🎉');
      return;
    }
    setReview({ queue, index: 0, finished: false, results: [] });
  };
  const stopReview = () => setReview(null);
  const restartReview = () => {
    if (!review) return;
    const due = review.queue.filter((id) => {
      const c = cards.find((x) => x.id === id);
      return c && isDue(c);
    });
    if (due.length) setReview({ queue: due, index: 0, finished: false, results: [] });
    else setReview(null);
  };
  const handleRate = (quality) => {
    if (!review || review.finished) return;
    const id = review.queue[review.index];
    const card = cards.find((c) => c.id === id);
    if (card) {
      const reviews = sm2(quality, card.reviews || undefined);
      commit({
        cards: cards.map((c) => (c.id === id ? { ...c, reviews, updatedAt: new Date().toISOString() } : c)),
      });
    }
    setReview((prev) => {
      const finished = prev.index + 1 >= prev.queue.length;
      return { ...prev, index: prev.index + 1, finished, results: [...prev.results, { id, quality }] };
    });
  };

  // ---------- 树 ----------
  const handleTreeSelect = (kind, id) => {
    setFilter((f) => ({ ...f, [kind === 'cat' ? 'catId' : 'tagId']: id }));
  };
  const handleTreeToggle = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  const handleTreeAdd = (kind, parentId) => {
    const name = prompt('子节点名称：');
    if (!name || !name.trim()) return;
    const node = { id: uid(kind === 'cat' ? 'k' : 't'), name: name.trim(), children: [] };
    const roots = kind === 'cat' ? categories : tags;
    commit(kind === 'cat' ? { categories: treeAdd(roots, parentId, node) } : { tags: treeAdd(roots, parentId, node) });
    if (parentId) setExpanded((e) => ({ ...e, [parentId]: true }));
  };
  const handleTreeRename = (kind, id) => {
    const roots = kind === 'cat' ? categories : tags;
    const node = findNode(roots, id);
    if (!node) return;
    const nn = prompt('新名称：', node.name);
    if (nn && nn.trim() && nn.trim() !== node.name) {
      commit(kind === 'cat' ? { categories: treeRename(roots, id, nn.trim()) } : { tags: treeRename(roots, id, nn.trim()) });
    }
  };
  const handleTreeDelete = (kind, id) => {
    const roots = kind === 'cat' ? categories : tags;
    const node = findNode(roots, id);
    if (!node) return;
    if (!confirm(`删除「${node.name}」及其全部子节点？卡片上的相关关联也会被移除。`)) return;
    const removed = [];
    const nextRoots = treeDelete(roots, id, removed);
    const ids = subtreeIds(node);
    let nextCards = cards;
    if (kind === 'cat') {
      nextCards = cards.map((c) => (ids.has(c.categoryId) ? { ...c, categoryId: null } : c));
    } else {
      nextCards = cards.map((c) => ({ ...c, tags: (c.tags || []).filter((t) => !ids.has(t)) }));
    }
    commit(kind === 'cat' ? { categories: nextRoots, cards: nextCards } : { tags: nextRoots, cards: nextCards });
    setFilter((f) => (f[kind === 'cat' ? 'catId' : 'tagId'] && ids.has(f[kind === 'cat' ? 'catId' : 'tagId'])
      ? { ...f, [kind === 'cat' ? 'catId' : 'tagId']: null }
      : f));
    setExpanded((e) => {
      const next = { ...e };
      ids.forEach((i) => delete next[i]);
      return next;
    });
  };
  const handleDragStart = (kind, id) => setDragging({ kind, id });
  const handleDragEnd = () => setDragging(null);
  const handleTreeDrop = (kind, dragId, targetId, pos) => {
    const roots = kind === 'cat' ? categories : tags;
    if (!dragId || dragId === targetId) return;
    const dragNode = findNode(roots, dragId);
    if (!dragNode) return;
    if (subtreeIds(dragNode).has(targetId)) return; // 不能拖入自己的子树
    const next = treeMove(roots, dragId, targetId, pos);
    if (!next) return;
    setDragging(null);
    commit(kind === 'cat' ? { categories: next } : { tags: next });
    if (pos === 'child') setExpanded((e) => ({ ...e, [targetId]: true }));
  };

  // ---------- 导入导出 ----------
  const handleExport = () => {
    const data = { version: 3, cards, categories, tags };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `knowledge-cards-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleFileChange = (e) => {
    if (e.target.files[0]) handleImport(e.target.files[0]);
    e.target.value = '';
  };

  const handleImport = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        let newCards, newCats, newTags;
        if (Array.isArray(data)) {
          newCards = data; newCats = []; newTags = [];
        } else if (data && Array.isArray(data.cards)) {
          newCards = data.cards; newCats = data.categories || []; newTags = data.tags || [];
        } else {
          throw new Error('bad format');
        }
        const valid = newCards
          .filter((c) => c && typeof c === 'object')
          .map((c) => ({
            id: c.id || uid('c'),
            front: c.front || '',
            back: c.back || '',
            categoryId: c.categoryId || null,
            pinned: !!c.pinned,
            reviews: c.reviews && typeof c.reviews === 'object' ? { ...c.reviews } : null,
            tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
            createdAt: c.createdAt || new Date().toISOString(),
            updatedAt: c.updatedAt || new Date().toISOString(),
          }));
        if (!confirm(`导入 ${valid.length} 张卡片？分类/标签树将合并，卡片追加到现有列表。`)) return;
        const nextCategories = mergeTrees([...categories], newCats);
        const nextTags = mergeTrees([...tags], newTags);
        const existing = new Set(cards.map((c) => c.id));
        const added = valid.filter((c) => !existing.has(c.id));
        const m = migrate([...added, ...cards], nextTags);
        const nextExpanded = { ...expanded, ...expandAll(nextCategories), ...expandAll(nextTags) };
        commit({ cards: m.cards, categories: nextCategories, tags: m.tags });
        setExpanded(nextExpanded);
      } catch {
        alert('导入失败：不是有效的卡片 JSON 文件');
      }
    };
    reader.readAsText(file);
  };

  // ---------- 全局快捷键 ----------
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (review) return; // 复习弹窗自己处理 Esc
        if (editingId !== null) closeEditor();
        else setFilter((f) => ({ ...f, query: '' }));
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editingId, review, undo, redo]);

  // 复习菜单点击外部关闭
  useEffect(() => {
    if (!reviewMenu) return;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setReviewMenu(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [reviewMenu]);

  return (
    <>
      <header>
        <div className="bar">
          <button id="btnSide" title="展开/收起侧边栏" onClick={() => setSideOpen((v) => !v)}>☰</button>
          <h1>📇 知识卡片 <span className="ver">React</span></h1>
          <div className="grow" />
          <button className="ghost icon" title="撤销 (Ctrl/⌘+Z)" disabled={!history.length} onClick={undo}>↩</button>
          <button className="ghost icon" title="重做 (Ctrl/⌘+Shift+Z)" disabled={!future.length} onClick={redo}>↪</button>
          <input
            id="search" type="search" placeholder="搜索卡片… (Esc 清空)"
            value={filter.query}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
          />
          <select
            id="sortSel" title="排序方式" value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
          >
            <option value="default">默认顺序</option>
            <option value="created">最近创建</option>
            <option value="updated">最近更新</option>
            <option value="title">标题 A→Z</option>
            <option value="titleDesc">标题 Z→A</option>
          </select>
          <span className="count" id="count">{visibleCards.length} / {cards.length}</span>
          <div className="review-wrap" ref={menuRef}>
            <button className="btn-review" onClick={() => setReviewMenu((v) => !v)}>
              复习{dueCount > 0 ? ` (${dueCount})` : ''} ▾
            </button>
            {reviewMenu && (
              <div className="review-menu">
                <button onClick={() => { setReviewMenu(false); startReview(false); }}>
                  复习到期卡片（{dueCount}）
                </button>
                <button onClick={() => { setReviewMenu(false); startReview(true); }}>
                  复习全部卡片（{cards.length}）
                </button>
              </div>
            )}
          </div>
          <button className="ghost" title="导出全部数据为 JSON" onClick={handleExport}>导出</button>
          <button className="ghost" title="从 JSON 文件导入" onClick={() => fileRef.current?.click()}>导入</button>
          <button
            className="ghost icon" title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button className="primary" onClick={() => openEditor('new')}>＋ 新建</button>
          <input
            ref={fileRef} type="file" accept=".json,application/json"
            style={{ display: 'none' }} onChange={handleFileChange}
          />
        </div>
      </header>

      <div className="layout">
        <Sidebar
          categories={categories} tags={tags}
          counts={{ cat: catCounts, tag: tagCounts }} filterId={filter}
          expanded={expanded}
          onSelect={handleTreeSelect} onToggle={handleTreeToggle}
          onAdd={handleTreeAdd} onRename={handleTreeRename} onDelete={handleTreeDelete}
          onAddRoot={(kind) => handleTreeAdd(kind, null)}
          dragging={dragging} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDrop={handleTreeDrop}
        />
        <main>
          <FilterBar filter={filter} categories={categories} tags={tags}
            onClear={(kind) => setFilter((f) => ({ ...f, [kind === 'cat' ? 'catId' : 'tagId']: null }))}
          />
          <CardGrid
            cards={visibleCards} total={cards.length} categories={categories} tags={tags}
            onEdit={openEditor}
            onFilterTag={(tid) => setFilter((f) => ({ ...f, tagId: tid }))}
            onFilterCat={(cid) => setFilter((f) => ({ ...f, catId: cid }))}
            onTogglePin={handleTogglePin}
          />
        </main>
      </div>

      {editingId !== null && (
        <EditorModal
          key={editingId}
          mode={editingId === 'new' ? 'new' : 'edit'}
          card={editingCard}
          categories={categories} tags={tags}
          onSave={handleSave} onClose={closeEditor} onDelete={handleDeleteCard} onDuplicate={handleDuplicate}
        />
      )}

      {review && (
        <ReviewModal
          card={reviewCard} index={review.index} total={review.queue.length}
          finished={review.finished} results={review.results}
          onRate={handleRate} onExit={stopReview} onRestart={restartReview}
        />
      )}
    </>
  );
}
