import { Fragment, useState } from 'react';

export default function Tree({
  roots, kind, label, filterId, counts, expanded,
  onSelect, onToggle, onAdd, onRename, onDelete,
  dragging, onDragStart, onDragEnd, onDrop,
}) {
  const [drop, setDrop] = useState(null); // { id, pos: 'before'|'after'|'child' }
  return (
    <div onDragEnd={() => setDrop(null)}>
      <div
        className={`tree-row${filterId ? '' : ' sel'}`}
        data-kind={kind}
        data-id=""
        onClick={() => onSelect(kind, null)}
      >
        <span className="tw leaf" />
        <span className="tname">{label}</span>
      </div>
      {roots.map((n) => (
        <Node
          key={n.id} node={n} depth={0} kind={kind}
          filterId={filterId} counts={counts} expanded={expanded}
          onSelect={onSelect} onToggle={onToggle} onAdd={onAdd} onRename={onRename} onDelete={onDelete}
          drop={drop} setDrop={setDrop}
          dragging={dragging} onDragStart={onDragStart} onDragEnd={onDragEnd} onDrop={onDrop}
        />
      ))}
    </div>
  );
}

function Node({
  node, depth, kind, filterId, counts, expanded,
  onSelect, onToggle, onAdd, onRename, onDelete,
  drop, setDrop, dragging, onDragStart, onDragEnd, onDrop,
}) {
  const has = node.children && node.children.length > 0;
  const exp = !!expanded[node.id];
  const sel = filterId === node.id;
  const c = counts[node.id] || 0;
  const isDragging = dragging && dragging.id === node.id;
  const dropPos = drop && drop.id === node.id ? drop.pos : null;

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    const pos = y < r.height * 0.25 ? 'before' : y > r.height * 0.75 ? 'after' : 'child';
    if (dropPos !== pos) setDrop({ id: node.id, pos });
  };
  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDrop(null);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const dragId = e.dataTransfer.getData('text/plain') || (dragging && dragging.id);
    if (dragId) onDrop(kind, dragId, node.id, dropPos || 'child');
    setDrop(null);
  };
  const handleDragStart = (e) => {
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', node.id);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(kind, node.id);
  };

  return (
    <Fragment>
      <div
        className={`tree-row${sel ? ' sel' : ''}${isDragging ? ' dragging' : ''}${dropPos ? ' drop-' + dropPos : ''}`}
        data-kind={kind}
        data-id={node.id}
        style={{ paddingLeft: depth * 16 + 8 }}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => onSelect(kind, node.id)}
        onDoubleClick={() => onRename(kind, node.id)}
      >
        <span
          className={`tw${has ? '' : ' leaf'}`}
          onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
        >
          {has ? (exp ? '▾' : '▸') : ''}
        </span>
        <span className="tname">{node.name}</span>
        {c ? <span className="tcount">{c}</span> : null}
        <span className="tactions">
          <button className="mini" title="添加子节点" onClick={(e) => { e.stopPropagation(); onAdd(kind, node.id); }}>＋</button>
          <button className="mini" title="重命名" onClick={(e) => { e.stopPropagation(); onRename(kind, node.id); }}>✎</button>
          <button className="mini del" title="删除（含子节点）" onClick={(e) => { e.stopPropagation(); onDelete(kind, node.id); }}>✕</button>
        </span>
      </div>
      {has && exp
        ? node.children.map((ch) => (
          <Node
            key={ch.id} node={ch} depth={depth + 1} kind={kind}
            filterId={filterId} counts={counts} expanded={expanded}
            onSelect={onSelect} onToggle={onToggle} onAdd={onAdd} onRename={onRename} onDelete={onDelete}
            drop={drop} setDrop={setDrop}
            dragging={dragging} onDragStart={onDragStart} onDragEnd={onDragEnd} onDrop={onDrop}
          />
        ))
        : null}
    </Fragment>
  );
}
