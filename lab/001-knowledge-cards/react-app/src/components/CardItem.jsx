import { useState } from 'react';
import { findNode } from '../store';

export default function CardItem({ card, categories, tags, onEdit, onFilterTag, onFilterCat, onTogglePin }) {
  const [flipped, setFlipped] = useState(false);
  const cat = card.categoryId ? findNode(categories, card.categoryId) : null;
  const tagChips = (card.tags || [])
    .map((tid) => ({ tid, name: findNode(tags, tid)?.name }))
    .filter((t) => t.name)
    .map((t) => (
      <span
        key={t.tid}
        className="tag"
        data-tag={t.tid}
        title="点击按标签筛选"
        onClick={(e) => { e.stopPropagation(); onFilterTag(t.tid); }}
      >
        {t.name}
      </span>
    ));

  return (
    <div
      className={`flip${flipped ? ' flipped' : ''}${card.pinned ? ' pinned' : ''}`}
      data-id={card.id}
      title="点击翻转 · 右下角 ✏️ 编辑"
      onClick={() => setFlipped((f) => !f)}
    >
      <div className="inner">
        <div className="face">
          <div className="head">
            <span className="label">正面</span>
            <span className="head-right">
              {cat && (
                <span
                  className="cat-badge"
                  title="点击按分类筛选"
                  onClick={(e) => { e.stopPropagation(); onFilterCat(cat.id); }}
                >
                  {cat.name}
                </span>
              )}
              <button
                className={`pin${card.pinned ? ' on' : ''}`}
                title={card.pinned ? '取消置顶' : '置顶'}
                onClick={(e) => { e.stopPropagation(); onTogglePin(card.id); }}
              >
                📌
              </button>
            </span>
          </div>
          <div className="front-text">{card.front || '（无标题）'}</div>
          {tagChips.length ? <div className="tags">{tagChips}</div> : null}
        </div>
        <div className="face back">
          <div className="label">背面</div>
          <div className="back-text">{card.back || '—'}</div>
        </div>
      </div>
      <button
        className="card-edit"
        title="编辑卡片"
        onClick={(e) => { e.stopPropagation(); onEdit(card.id); }}
      >
        ✏️
      </button>
    </div>
  );
}
