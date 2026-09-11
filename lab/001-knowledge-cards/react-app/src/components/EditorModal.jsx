import { useState } from 'react';
import { flatten } from '../store';

export default function EditorModal({ mode, card, categories, tags, onSave, onClose, onDelete, onDuplicate }) {
  const [front, setFront] = useState(card?.front ?? '');
  const [back, setBack] = useState(card?.back ?? '');
  const [catId, setCatId] = useState(card?.categoryId ?? '');
  const [tagIds, setTagIds] = useState(() => new Set(card?.tags ?? []));

  const toggleTag = (id) => {
    setTagIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  };

  const catOptions = flatten(categories, 0);
  const tagOptions = flatten(tags, 0);

  const save = () => {
    onSave({
      front: front.trim(),
      back: back.trim(),
      categoryId: catId || null,
      tags: [...tagIds],
    });
  };

  return (
    <div
      id="overlay"
      className="open"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div id="modal">
        <h2>{mode === 'new' ? '新建卡片' : '编辑卡片'}</h2>
        <label className="lbl" htmlFor="fFront">正面（问题 / 标题）</label>
        <input
          id="fFront" type="text" autoFocus
          value={front} onChange={(e) => setFront(e.target.value)}
          placeholder="例如：什么是闭包？"
        />
        <label className="lbl" htmlFor="fBack">背面（答案 / 内容）</label>
        <textarea
          id="fBack" rows="5"
          value={back} onChange={(e) => setBack(e.target.value)}
          placeholder="例如：闭包是函数与其词法环境的组合……"
        />
        <label className="lbl" htmlFor="fCat">分类（树形选择）</label>
        <select id="fCat" value={catId} onChange={(e) => setCatId(e.target.value)}>
          <option value="">（无分类）</option>
          {catOptions.map((o) => (
            <option key={o.node.id} value={o.node.id}>
              {'\u3000'.repeat(o.depth)}{o.node.name}
            </option>
          ))}
        </select>
        <label className="lbl">标签（树形勾选，可多选）</label>
        <div id="fTagList">
          {tagOptions.length === 0 ? (
            <div className="hint">还没有标签，先在左侧「标签」树里添加。</div>
          ) : (
            tagOptions.map((o) => (
              <label key={o.node.id} className="tag-opt" style={{ paddingLeft: o.depth * 18 + 4 }}>
                <input
                  type="checkbox"
                  checked={tagIds.has(o.node.id)}
                  onChange={() => toggleTag(o.node.id)}
                />
                {o.node.name}
              </label>
            ))
          )}
        </div>
        <div className="modal-actions">
          {mode !== 'new' && (
            <>
              <button className="danger" onClick={onDelete}>删除</button>
              <button className="ghost" title="复制为一张新卡片" onClick={onDuplicate}>复制</button>
            </>
          )}
          <div className="grow" />
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
