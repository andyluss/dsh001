import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';

// 在导入 App 之前准备好浏览器 API 桩（loadState 在首次渲染时执行）
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
};
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.prompt = () => null;

import App from './App.jsx';

const stripComments = (h) => h.replace(/<!--.*?-->/g, '');

describe('App SSR 冒烟', () => {
  it('全新数据：渲染出种子卡片、分类树、标签树', () => {
    mem.clear();
    const html = renderToString(<App />);
    expect(html).toContain('什么是闭包？');
    expect(html).toContain('card-edit'); // 右下角编辑按钮
    expect(html).toContain('E = mc²');
    expect(html).toContain('全部分类');
    expect(html).toContain('全部标签');
    expect(html).toContain('前端');
    expect(html).toContain('面试');
    expect(stripComments(html)).toContain('>3 / 3<'); // React SSR 会在文本间插入注释节点
    expect(html).toContain('React'); // 版本角标
  });

  it('已有数据：正常渲染且不重复播种', () => {
    mem.clear();
    // 模拟旧版数据（字符串标签），验证迁移 + 渲染
    mem.set('kcards.v1', JSON.stringify([
      { id: 'old1', front: '旧卡', back: '旧内容', tags: ['面试'], createdAt: 'x', updatedAt: 'x' },
    ]));
    const html = renderToString(<App />);
    expect(html).toContain('旧卡');
    expect(stripComments(html)).toContain('>1 / 1<');
    const tags = JSON.parse(mem.get('ktags.v1'));
    expect(tags.length).toBe(1);
    expect(tags[0].name).toBe('面试');
    const cards = JSON.parse(mem.get('kcards.v1'));
    expect(cards[0].tags[0]).toBe(tags[0].id);
  });
});
