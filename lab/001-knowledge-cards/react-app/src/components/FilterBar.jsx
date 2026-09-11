import { findNode } from '../store';

export default function FilterBar({ filter, categories, tags, onClear }) {
  const cat = filter.catId ? findNode(categories, filter.catId) : null;
  const tag = filter.tagId ? findNode(tags, filter.tagId) : null;
  if (!cat && !tag) return <div id="filterBar" />;
  return (
    <div id="filterBar">
      {cat && (
        <span className="chip">
          分类: {cat.name}
          <button title="清除" onClick={() => onClear('cat')}>✕</button>
        </span>
      )}
      {tag && (
        <span className="chip">
          标签: {tag.name}
          <button title="清除" onClick={() => onClear('tag')}>✕</button>
        </span>
      )}
    </div>
  );
}
