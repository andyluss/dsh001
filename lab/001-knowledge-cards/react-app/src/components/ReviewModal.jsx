import { useEffect, useState } from 'react';

const RATES = [
  { q: 0, label: '忘记', emoji: '😵', cls: 'again', hint: '1' },
  { q: 3, label: '模糊', emoji: '🤔', cls: 'hard', hint: '2' },
  { q: 4, label: '认识', emoji: '🙂', cls: 'good', hint: '3' },
  { q: 5, label: '简单', emoji: '😎', cls: 'easy', hint: '4' },
];

export default function ReviewModal({ card, index, total, finished, results, onRate, onExit, onRestart }) {
  const [flipped, setFlipped] = useState(false);

  useEffect(() => { setFlipped(false); }, [card && card.id]);

  useEffect(() => {
    const onKey = (e) => {
      if (finished) {
        if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); onExit(); }
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped((f) => !f); return; }
      if (e.key === '1') onRate(0);
      else if (e.key === '2') onRate(3);
      else if (e.key === '3') onRate(4);
      else if (e.key === '4') onRate(5);
      else if (e.key === 'Escape') onExit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [finished, card && card.id, onRate, onExit]);

  const tally = {};
  results.forEach((r) => { tally[r.quality] = (tally[r.quality] || 0) + 1; });

  return (
    <div id="reviewOverlay">
      <div className="review-card">
        {finished ? (
          <>
            <h2>🎉 复习完成</h2>
            <p className="review-summary">本次共复习 {results.length} 张</p>
            <div className="review-tally">
              {RATES.map((r) => (
                <span key={r.q} className={`tally ${r.cls}`}>{r.emoji} {r.label} {tally[r.q] || 0}</span>
              ))}
            </div>
            <div className="review-actions">
              <button onClick={onRestart}>再来一轮</button>
              <button className="primary" onClick={onExit}>完成</button>
            </div>
          </>
        ) : card ? (
          <>
            <div className="review-progress">
              第 {index + 1} / {total} 张{card.pinned ? ' · 📌 置顶' : ''}
            </div>
            <div className="review-front" onClick={() => setFlipped((f) => !f)}>
              {card.front || '（无标题）'}
            </div>
            {flipped && <div className="review-back">{card.back || '—'}</div>}
            <div className="review-actions">
              {!flipped ? (
                <button className="primary" onClick={() => setFlipped(true)}>显示答案 (空格)</button>
              ) : (
                RATES.map((r) => (
                  <button key={r.q} className={`rate ${r.cls}`} onClick={() => onRate(r.q)}>
                    {r.emoji} {r.label} <span className="kbd">{r.hint}</span>
                  </button>
                ))
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
