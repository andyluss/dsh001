import Tree from './Tree';

export default function Sidebar({
  categories, tags, counts, filterId, expanded,
  onSelect, onToggle, onAdd, onRename, onDelete, onAddRoot,
  dragging, onDragStart, onDragEnd, onDrop,
}) {
  return (
    <aside id="sidebar">
      <div className="side-sec">
        <div className="side-title">
          <span>📁 分类</span>
          <button className="mini" title="添加根分类" onClick={() => onAddRoot('cat')}>＋ 根分类</button>
        </div>
        <Tree
          roots={categories} kind="cat" label="全部分类" filterId={filterId.catId}
          counts={counts.cat} expanded={expanded}
          onSelect={onSelect} onToggle={onToggle} onAdd={onAdd} onRename={onRename} onDelete={onDelete}
          dragging={dragging} onDragStart={onDragStart} onDragEnd={onDragEnd} onDrop={onDrop}
        />
      </div>
      <div className="side-sec">
        <div className="side-title">
          <span>🏷 标签</span>
          <button className="mini" title="添加根标签" onClick={() => onAddRoot('tag')}>＋ 根标签</button>
        </div>
        <Tree
          roots={tags} kind="tag" label="全部标签" filterId={filterId.tagId}
          counts={counts.tag} expanded={expanded}
          onSelect={onSelect} onToggle={onToggle} onAdd={onAdd} onRename={onRename} onDelete={onDelete}
          dragging={dragging} onDragStart={onDragStart} onDragEnd={onDragEnd} onDrop={onDrop}
        />
      </div>
    </aside>
  );
}
