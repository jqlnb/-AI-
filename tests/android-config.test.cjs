const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../capacitor.config.json');

test('Android 15 edge-to-edge content stays inside system bar insets', () => {
  assert.equal(config.android?.adjustMarginsForEdgeToEdge, 'auto');
});
