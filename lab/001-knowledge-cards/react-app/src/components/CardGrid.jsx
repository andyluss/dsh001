import CardItem from './CardItem';

export default function CardGrid({ cards, total, categories, tags, onEdit, onFilterTag, onFilterCat, onTogglePin }) {
  if (!cards.length) {
    return (
      <div className="empty">
        {total ? '没有匹配的卡片' : '还没有卡片，点「新建」添加第一张吧 ✨'}
      </div>
    );
  }
  return (
    <div id="grid">
      {cards.map((c) => (
        <CardItem
          key={c.id} card={c} categories={categories} tags={tags}
          onEdit={onEdit} onFilterTag={onFilterTag} onFilterCat={onFilterCat} onTogglePin={onTogglePin}
        />
      ))}
    </div>
  );
}
