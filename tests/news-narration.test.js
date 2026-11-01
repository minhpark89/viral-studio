import test from 'node:test';
import assert from 'node:assert/strict';
import { NEWS_CTA, newsPlanSchema, writeNewsNarration } from '../server/news-plan.js';

const research = {
  headline: 'City transport review remains open',
  script: 'Officials published a transport review, but no decision has been announced.',
  articles: [{ source: 'City News', url: 'https://example.test/review' }],
};
const sentence = 'Officials published the transport review, but the next decision remains unknown. ';

test('news narration accepts overlong model summaries and fits the provider limit with the complete CTA', async () => {
  for (const length of [399, 400, 401, 450, 700, 4000]) {
    const summary = sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length);
    const result = await writeNewsNarration({}, research, {
      llm: async () => ({ headline: research.headline, summary, imageQueries: ['city transport'] }),
    });
    assert.ok(result.narration.length <= 500, `summary length ${length}`);
    assert.ok(result.narration.endsWith(' ' + NEWS_CTA));
    assert.ok(result.narration.startsWith('Officials published the transport review'));
    assert.equal(result.narration.split(NEWS_CTA).length, 2);
    assert.doesNotThrow(() => newsPlanSchema.parse({ ...result, imageMediaIds: ['11111111-1111-4111-8111-111111111111'] }));
  }
});

test('news narration still rejects missing, non-text, empty and unreasonably large model summaries', async () => {
  for (const summary of [undefined, null, {}, 42, '', '   ', 'x'.repeat(16001)]) {
    await assert.rejects(writeNewsNarration({}, research, {
      llm: async () => ({ headline: research.headline, summary, imageQueries: ['city transport'] }),
    }));
  }
});
