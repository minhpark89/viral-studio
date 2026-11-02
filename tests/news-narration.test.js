import test from 'node:test';
import assert from 'node:assert/strict';
import { NEWS_CTA, newsPlanSchema, writeNewsNarration, fitNewsSummary } from '../server/news-plan.js';
import { newsScriptBudget } from '../shared/news-format.js';

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

test('short news summaries retain confirmed facts without invented suspense, repeated claims or duplicate CTA', async () => {
  const summary = 'Officials published the city transport review on Monday. The council will discuss the report at its next meeting.';
  const result = await writeNewsNarration({}, research, { llm: async () => ({ headline: research.headline, summary: summary + ' ' + NEWS_CTA, imageQueries: ['City transport'] }) });
  assert.equal(result.narration, summary + ' ' + NEWS_CTA);
  assert.doesNotMatch(result.narration, /key details unanswered|next confirmed update|important details open/);
  assert.equal(fitNewsSummary('A confirmed fact is available. A confirmed fact is available. An unfinished clause', { characters: 400, words: 60 }), 'A confirmed fact is available.');
});

test('duration targets change the complete-sentence budget and survive the saved plan', async () => {
  const summary = 'The council approved the transport plan on Monday. The plan includes new bus routes across the city. Work will begin after the public consultation closes. The report includes the routes and the consultation schedule.';
  const outputs = [];
  for (const newsDuration of [15, 20, 30, 'auto']) {
    const result = await writeNewsNarration({}, research, { newsDuration, newsImageCount: 10, llm: async () => ({ headline: research.headline, summary, imageQueries: ['City transport'] }) });
    assert.ok(result.narration.length <= newsScriptBudget(newsDuration).characters);
    assert.match(result.narration, /\. Read the full story/);
    assert.equal(result.newsDuration, newsDuration);
    assert.equal(result.newsImageCount, 10);
    outputs.push(result.narration.length);
  }
  assert.ok(outputs[0] < outputs[2]);
});

test('an oversized first sentence is rewritten once instead of cut mid-fact', async () => {
  let calls = 0;
  const result = await writeNewsNarration({}, research, { newsDuration: 15, llm: async () => ({ headline: research.headline, summary: ++calls === 1 ? 'Very long '.repeat(100) + 'report.' : 'The city published its transport review on Monday.', imageQueries: ['City transport'] }) });
  assert.equal(calls, 2);
  assert.equal(result.narration, 'The city published its transport review on Monday. ' + NEWS_CTA);
});
