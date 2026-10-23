import { describe, expect, it } from 'vitest';
import { activitySources, websiteUrl } from '@/components/assistant/activity';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentTrail } from '@/components/assistant/activity-trail';
import { MessageBubble } from '@/components/assistant/message-bubble';

describe('activity source links', () => {
  it('keeps distinct pages on the same website and deduplicates repeated visits', () => {
    const sources = activitySources([
      { label: 'Searched', url: 'https://example.org/search?q=anya' },
      { label: 'Opened profile', url: 'https://example.org/anya' },
      { label: 'Read profile', url: 'https://example.org/anya' },
    ], 'https://example.org/anya');
    expect(sources.map((source) => source.url)).toEqual(['https://example.org/search?q=anya', 'https://example.org/anya']);
  });

  it('supports old saved text trails and a final-page link without any trail', () => {
    expect(activitySources(['Opening browser', 'Finished'], 'https://www.example.org/anya')[0]).toMatchObject({ host: 'example.org', url: 'https://www.example.org/anya' });
    expect(activitySources([], 'https://example.org/anya')).toHaveLength(1);
  });

  it('excludes blank tabs, malformed URLs, and executable URLs', () => {
    for (const url of ['about:blank', 'javascript:alert(1)', 'data:text/html,x', 'not a URL']) {
      expect(websiteUrl(url)).toBeUndefined();
      expect(activitySources([{ label: 'Step', url }], url)).toEqual([]);
    }
  });

  it('renders clickable visited pages in the disclosure and counts websites, not steps', () => {
    const html = renderToStaticMarkup(createElement(AgentTrail, { trail: [
      { label: 'Search', url: 'https://example.org/search' },
      { label: 'Read profile', url: 'https://example.org/anya' },
      { label: 'Read reference', url: 'https://reference.org/anya' },
    ] }));
    expect(html).toContain('Visited 2 websites');
    expect(html).toContain('href="https://example.org/anya"');
    expect(html).toContain('href="https://reference.org/anya"');
    expect(html).toContain('Websites visited');
    expect(html).toContain('<details');
  });

  it('renders images with captions and source links in the reply', () => {
    const html = renderToStaticMarkup(createElement(MessageBubble, { msg: {
      id: 'reply', role: 'assistant', content: '![Character design](https://images.example.org/anya.png)\n\n[Source page](https://example.org/anya)',
      agent: { goal: 'Find character images', status: 'done', trail: ['Finished'], url: 'https://example.org/anya' },
    } }));
    expect(html).toContain('src="https://images.example.org/anya.png"');
    expect(html).toContain('sk-message-image');
    expect(html).toContain('Character design</span>');
    expect(html).toContain('href="https://example.org/anya"');
  });
});
